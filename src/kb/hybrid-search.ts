import { Vault } from '../vault.js';
import { loadIndex, chunkNote, base64ToVec, type EmbeddingIndex } from './index-store.js';
import { resolveEmbedConfig, makeEmbedFn, type EmbedFn } from './embeddings.js';

/**
 * Hybrid search: BM25 keyword ranking + cosine vector ranking, merged with
 * Reciprocal Rank Fusion and a source-tier boost.
 *
 * rrfFusion and cosineSimilarity are adapted from Garry Tan's gbrain
 * (https://github.com/garrytan/gbrain, MIT license, © 2026 Garry Tan) —
 * src/core/search/hybrid.ts.
 */

export type SearchMode = 'keyword' | 'semantic' | 'hybrid';

export interface HybridResult {
  path: string;
  chunkId: string;
  heading: string;
  snippet: string;
  score: number;
}

export interface HybridSearchReport {
  mode: SearchMode;
  effectiveMode: SearchMode;   // what actually ran (fallbacks downgrade)
  warning?: string;
  results: HybridResult[];
}

interface SearchChunk {
  path: string;
  chunkId: string;
  heading: string;
  text: string;
  vec: Float32Array | null;
}

// ---- tokenizing + BM25 -------------------------------------------------------

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 1);
}

const BM25_K1 = 1.5;
const BM25_B = 0.75;

/**
 * Classic Okapi BM25 over the chunk set, tier-boosted. Returns chunks ranked
 * descending. The boost is applied to raw scores (not post-fusion ranks) so
 * it only reorders hits of comparable relevance — RRF ranks are too flat for
 * a post-hoc multiplier not to overpower genuine relevance differences.
 */
export function bm25Rank(chunks: SearchChunk[], query: string, k: number): SearchChunk[] {
  const qTerms = [...new Set(tokenize(query))];
  if (qTerms.length === 0) return [];

  const docs = chunks.map(c => tokenize(`${c.heading} ${c.text}`));
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / Math.max(1, docs.length);

  const df = new Map<string, number>();
  for (const doc of docs) {
    const seen = new Set(doc);
    for (const term of qTerms) if (seen.has(term)) df.set(term, (df.get(term) ?? 0) + 1);
  }

  const N = docs.length;
  const scored = chunks.map((c, i) => {
    const doc = docs[i];
    const tf = new Map<string, number>();
    for (const t of doc) if (qTerms.includes(t)) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const term of qTerms) {
      const f = tf.get(term) ?? 0;
      if (f === 0) continue;
      const n = df.get(term) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * (f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + BM25_B * doc.length / avgLen));
    }
    return { chunk: c, score: score * tierBoost(c.path) };
  });

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(s => s.chunk);
}

// ---- vector ranking ----------------------------------------------------------

// Adapted from gbrain src/core/search/hybrid.ts (MIT)
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, magA = 0, magB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

function vectorRank(chunks: SearchChunk[], queryVec: Float32Array, k: number): SearchChunk[] {
  return chunks
    .filter(c => c.vec && c.vec.length > 0)
    .map(c => ({ chunk: c, score: cosineSimilarity(queryVec, c.vec!) * tierBoost(c.path) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(s => s.chunk);
}

// ---- fusion ------------------------------------------------------------------

const RRF_K = 60;

/**
 * Reciprocal Rank Fusion: each result scores sum(1/(K + rank)) across the
 * lists it appears in, normalized to 0-1. Tier boosting happens inside the
 * individual rankers, on raw scores — adjacent RRF ranks differ by <2%, so
 * a post-fusion multiplier would let tier override real relevance.
 * Adapted from gbrain src/core/search/hybrid.ts (MIT).
 */
export function rrfFusion(lists: SearchChunk[][]): Array<{ chunk: SearchChunk; score: number }> {
  const scores = new Map<string, { chunk: SearchChunk; score: number }>();
  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const c = list[rank];
      const existing = scores.get(c.chunkId);
      const rrfScore = 1 / (RRF_K + rank);
      if (existing) existing.score += rrfScore;
      else scores.set(c.chunkId, { chunk: c, score: rrfScore });
    }
  }
  const entries = [...scores.values()];
  if (entries.length === 0) return [];
  const maxScore = Math.max(...entries.map(e => e.score));
  for (const e of entries) {
    e.score = e.score / maxScore;
  }
  return entries.sort((a, b) => b.score - a.score);
}

/** Compiled wiki pages outrank raw dumps; generated outputs rank below both. */
export function tierBoost(path: string): number {
  if (path.startsWith('compiled/') || path.startsWith('wiki/')) return 1.2;
  if (path.startsWith('outputs/')) return 0.8;
  return 1.0;
}

// ---- chunk loading -----------------------------------------------------------

function chunksFromIndex(index: EmbeddingIndex): SearchChunk[] {
  const chunks: SearchChunk[] = [];
  for (const [path, file] of Object.entries(index.files)) {
    for (const c of file.chunks) {
      chunks.push({
        path,
        chunkId: c.id,
        heading: c.heading,
        text: c.text,
        vec: c.vec ? base64ToVec(c.vec) : null,
      });
    }
  }
  return chunks;
}

/** No index on disk: chunk the vault live (keyword-only search still works). */
async function chunksFromVault(vault: Vault): Promise<SearchChunk[]> {
  const chunks: SearchChunk[] = [];
  for (const path of await vault.listFiles('**/*.md')) {
    let raw: string;
    try { raw = vault.readFileRaw(path); } catch { continue; }
    chunkNote(raw).forEach((c, i) => {
      chunks.push({ path, chunkId: `${path}#${i}`, heading: c.heading, text: c.text, vec: null });
    });
  }
  return chunks;
}

// ---- public API ---------------------------------------------------------------

export interface HybridSearchOptions {
  k?: number;
  mode?: SearchMode;
  embedFn?: EmbedFn;   // injectable for tests
}

export async function hybridSearch(
  vault: Vault,
  query: string,
  opts: HybridSearchOptions = {},
): Promise<HybridSearchReport> {
  const k = opts.k ?? 10;
  const mode: SearchMode = opts.mode ?? 'hybrid';

  const index = loadIndex(vault.path);
  const chunks = index ? chunksFromIndex(index) : await chunksFromVault(vault);
  const hasVectors = chunks.some(c => c.vec && c.vec.length > 0);

  let warning: string | undefined;
  let effectiveMode: SearchMode = mode;

  let queryVec: Float32Array | null = null;
  if (mode !== 'keyword') {
    if (!index) {
      warning = 'No embedding index found (.obs-index/embeddings.json) — falling back to keyword search. Run `obs kb index` to build it.';
      effectiveMode = 'keyword';
    } else if (!hasVectors) {
      warning = 'Embedding index has no vectors — falling back to keyword search. Run `obs kb index --full`.';
      effectiveMode = 'keyword';
    } else {
      try {
        const embedFn = opts.embedFn ?? makeEmbedFn(resolveEmbedConfig({
          provider: index.provider as never,
          model: index.model,
          dimensions: index.dimensions,
        }));
        queryVec = new Float32Array((await embedFn([query]))[0]);
      } catch (err) {
        warning = `Embedding the query failed (${(err as Error).message.split('\n')[0]}) — falling back to keyword search.`;
        effectiveMode = 'keyword';
      }
    }
  }

  // over-fetch each ranker so fusion has enough overlap to work with
  const fetchK = Math.max(k * 3, 30);
  const lists: SearchChunk[][] = [];
  if (effectiveMode !== 'semantic') lists.push(bm25Rank(chunks, query, fetchK));
  if (queryVec && effectiveMode !== 'keyword') lists.push(vectorRank(chunks, queryVec, fetchK));

  const fused = rrfFusion(lists);

  // at most 2 chunks per file so one long note can't monopolise results
  const perFile = new Map<string, number>();
  const results: HybridResult[] = [];
  for (const { chunk, score } of fused) {
    const n = perFile.get(chunk.path) ?? 0;
    if (n >= 2) continue;
    perFile.set(chunk.path, n + 1);
    results.push({
      path: chunk.path,
      chunkId: chunk.chunkId,
      heading: chunk.heading,
      snippet: chunk.text.length > 300 ? chunk.text.slice(0, 300) + '…' : chunk.text,
      score: Math.round(score * 1000) / 1000,
    });
    if (results.length >= k) break;
  }

  return { mode, effectiveMode, warning, results };
}
