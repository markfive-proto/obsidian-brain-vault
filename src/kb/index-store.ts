import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Vault } from '../vault.js';
import type { EmbedFn } from './embeddings.js';

/**
 * On-disk embedding index at <vault>/.obs-index/embeddings.json.
 *
 * Flat JSON + brute-force cosine is deliberate: at this vault's scale
 * (~hundreds of notes, a few thousand chunks) a full scan is <10ms, and the
 * MCP gateway spawns a fresh server per session so nothing stays resident —
 * a database would buy nothing. Chunk text is stored alongside the vector so
 * keyword (BM25) and vector search read the same single file.
 */

export const INDEX_DIR = '.obs-index';
const INDEX_FILE = 'embeddings.json';

export interface IndexedChunk {
  id: string;        // "<relPath>#<n>"
  heading: string;   // nearest heading ('' for preamble)
  text: string;
  vec: string;       // base64-encoded Float32Array ('' if not embedded)
}

export interface IndexedFile {
  hash: string;      // sha256 of file content
  mtimeMs: number;
  chunks: IndexedChunk[];
}

export interface EmbeddingIndex {
  version: 1;
  provider: string;
  model: string;
  dimensions: number;
  updatedAt: string;
  files: Record<string, IndexedFile>;
}

// ---- chunking ---------------------------------------------------------------

const MAX_CHUNK_CHARS = 1500;

export interface Chunk {
  heading: string;
  text: string;
}

/**
 * Split a note body into heading-scoped chunks of at most ~1.5k chars.
 * Frontmatter is dropped; oversized sections are split on paragraph
 * boundaries.
 */
export function chunkNote(raw: string): Chunk[] {
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const lines = body.split('\n');
  const sections: Array<{ heading: string; lines: string[] }> = [{ heading: '', lines: [] }];
  for (const line of lines) {
    const m = line.match(/^#{1,6}\s+(.*)$/);
    if (m) sections.push({ heading: m[1].trim(), lines: [] });
    else sections[sections.length - 1].lines.push(line);
  }

  const chunks: Chunk[] = [];
  for (const s of sections) {
    const text = s.lines.join('\n').trim();
    if (!text) continue;
    if (text.length <= MAX_CHUNK_CHARS) {
      chunks.push({ heading: s.heading, text });
      continue;
    }
    // split long sections on blank lines, packing paragraphs greedily
    let buf = '';
    for (const para of text.split(/\n\s*\n/)) {
      if (buf && buf.length + para.length + 2 > MAX_CHUNK_CHARS) {
        chunks.push({ heading: s.heading, text: buf.trim() });
        buf = '';
      }
      // a single paragraph longer than the cap gets hard-split
      if (para.length > MAX_CHUNK_CHARS) {
        for (let i = 0; i < para.length; i += MAX_CHUNK_CHARS) {
          chunks.push({ heading: s.heading, text: para.slice(i, i + MAX_CHUNK_CHARS).trim() });
        }
        continue;
      }
      buf = buf ? `${buf}\n\n${para}` : para;
    }
    if (buf.trim()) chunks.push({ heading: s.heading, text: buf.trim() });
  }
  return chunks;
}

// ---- vector (de)serialization ----------------------------------------------

export function vecToBase64(vec: number[]): string {
  return Buffer.from(new Float32Array(vec).buffer).toString('base64');
}

export function base64ToVec(b64: string): Float32Array {
  const buf = Buffer.from(b64, 'base64');
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

// ---- load / save ------------------------------------------------------------

export function indexPath(vaultPath: string): string {
  return join(vaultPath, INDEX_DIR, INDEX_FILE);
}

export function loadIndex(vaultPath: string): EmbeddingIndex | null {
  const p = indexPath(vaultPath);
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf-8')) as EmbeddingIndex;
    if (parsed.version !== 1 || typeof parsed.files !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveIndex(vaultPath: string, index: EmbeddingIndex): void {
  const dir = join(vaultPath, INDEX_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(indexPath(vaultPath), JSON.stringify(index), 'utf-8');
}

export function contentHash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

// ---- build / refresh ---------------------------------------------------------

export interface BuildReport {
  filesTotal: number;
  filesEmbedded: number;
  filesUnchanged: number;
  filesRemoved: number;
  chunksEmbedded: number;
}

export interface BuildOptions {
  full?: boolean;
  meta: { provider: string; model: string; dimensions: number };
  embedFn: EmbedFn;
  onProgress?: (msg: string) => void;
}

/**
 * Incrementally (re)build the index: files whose content hash changed are
 * re-chunked and re-embedded; deleted files are dropped. A provider/model
 * change forces a full rebuild (vectors from different models don't mix).
 */
export async function buildIndex(vault: Vault, opts: BuildOptions): Promise<BuildReport> {
  const log = opts.onProgress ?? (() => {});
  const prev = opts.full ? null : loadIndex(vault.path);
  const providerChanged = prev !== null
    && (prev.provider !== opts.meta.provider || prev.model !== opts.meta.model || prev.dimensions !== opts.meta.dimensions);
  const base = providerChanged ? null : prev;
  if (providerChanged) log('Embedding provider/model changed — full rebuild.');

  const files = await vault.listFiles('**/*.md');
  const next: EmbeddingIndex = {
    version: 1,
    ...opts.meta,
    updatedAt: new Date().toISOString(),
    files: {},
  };

  const report: BuildReport = {
    filesTotal: files.length,
    filesEmbedded: 0,
    filesUnchanged: 0,
    filesRemoved: 0,
    chunksEmbedded: 0,
  };

  const toEmbed: Array<{ relPath: string; raw: string; hash: string; mtimeMs: number; chunks: Chunk[] }> = [];

  for (const relPath of files) {
    let raw: string;
    let mtimeMs: number;
    try {
      raw = vault.readFileRaw(relPath);
      mtimeMs = vault.fileStat(relPath).mtimeMs;
    } catch { continue; }
    const hash = contentHash(raw);
    const existing = base?.files[relPath];
    if (existing && existing.hash === hash) {
      next.files[relPath] = existing;
      report.filesUnchanged += 1;
      continue;
    }
    toEmbed.push({ relPath, raw, hash, mtimeMs, chunks: chunkNote(raw) });
  }

  report.filesRemoved = base ? Object.keys(base.files).filter(f => !files.includes(f)).length : 0;

  if (toEmbed.length) {
    log(`Embedding ${toEmbed.length} changed file(s)…`);
    const texts: string[] = [];
    for (const f of toEmbed) {
      for (const c of f.chunks) {
        // heading gives the vector local context, mirroring how a reader
        // would skim the note
        texts.push(c.heading ? `${c.heading}\n${c.text}` : c.text);
      }
    }
    const vectors = texts.length ? await opts.embedFn(texts) : [];
    let vi = 0;
    for (const f of toEmbed) {
      const chunks: IndexedChunk[] = f.chunks.map((c, i) => ({
        id: `${f.relPath}#${i}`,
        heading: c.heading,
        text: c.text,
        vec: vecToBase64(vectors[vi++] ?? []),
      }));
      next.files[f.relPath] = { hash: f.hash, mtimeMs: f.mtimeMs, chunks };
      report.filesEmbedded += 1;
      report.chunksEmbedded += chunks.length;
    }
  }

  saveIndex(vault.path, next);
  log(`Index saved: ${Object.keys(next.files).length} file(s).`);
  return report;
}
