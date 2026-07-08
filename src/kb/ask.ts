import { z } from 'zod';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { compiledDir, outputsDir, rawDir } from './paths.js';
import { llmObject, resolveLLMConfig, type LLMConfig } from './llm.js';
import { slugify, yamlFrontmatter } from './ingest.js';
import { Vault } from '../vault.js';
import { loadIndex } from './index-store.js';
import { hybridSearch } from './hybrid-search.js';
import type { EmbedFn } from './embeddings.js';

// ---- Schema -----------------------------------------------------------------

const AnswerSchema = z.object({
  restatedQuestion: z.string().describe('The question as a clean noun phrase — used as the note title.'),
  tldrBullets: z
    .array(z.string())
    .min(1)
    .max(7)
    .describe('3-5 high-signal bullets summarising the answer. No hedging.'),
  detailedAnswer: z
    .string()
    .describe('Full answer in markdown. MUST inline-cite sources as [[basename-of-source-file]] wikilinks on every factual claim. No trailing summary.'),
  evidence: z
    .array(
      z.object({
        claim: z.string(),
        sources: z.array(z.string()).describe('Wikilink basenames (without .md) that support this claim.'),
      }),
    )
    .describe('Claim-to-source map. One row per atomic claim. Each claim must have at least one source unless explicitly marked inferred.'),
  gaps: z
    .array(z.string())
    .describe('Things the wiki does NOT currently say about this question — seeds for future /ingest runs.'),
  confidence: z.enum(['high', 'medium', 'low']),
  confidenceReason: z.string().describe('One sentence explaining the confidence rating.'),
  relatedNotes: z
    .array(z.string())
    .describe('Up to 6 wikilink basenames that bridge to related concepts, worth following up.'),
});

type Answer = z.infer<typeof AnswerSchema>;

// ---- Options ----------------------------------------------------------------

export interface AskOptions {
  deep?: boolean;                 // second retrieval round seeded by round-1 gaps (needs the embedding index)
  includeRaw?: boolean;           // also load raw/ sources, not just compiled/
  budgetBytes?: number;           // context budget in bytes
  retrievalK?: number;            // max notes pulled by retrieval (default 12)
  config?: LLMConfig;
  addBacklinks?: boolean;         // append [[<answer>]] backlink to each cited concept page
  embedFn?: EmbedFn;              // injectable for tests
}

export interface AskResult {
  question: string;
  answer: Answer;
  sourcesConsidered: number;
  contextBytes: number;
  contextMode: 'retrieval' | 'corpus';
  rounds: number;
  answerPath: string;             // relative to vault root
  answerAbsPath: string;
}

// ---- Public API -------------------------------------------------------------

const DEFAULT_BUDGET = 280_000;   // ~70K tokens, comfortably fits Sonnet/Gemini context

export async function askKb(vaultPath: string, question: string, opts: AskOptions = {}): Promise<AskResult> {
  const config = opts.config ?? resolveLLMConfig();
  const budget = opts.budgetBytes ?? DEFAULT_BUDGET;
  const includeRaw = opts.includeRaw ?? false;

  // Prefer retrieval when the embedding index exists: pull only the notes
  // relevant to the question instead of the whole corpus. Falls back to the
  // corpus-in-budget load when no index has been built yet.
  let ctx = await loadRetrievedContext(vaultPath, question, {
    budgetBytes: budget,
    includeRaw,
    k: opts.retrievalK ?? 12,
    embedFn: opts.embedFn,
  });
  const contextMode: 'retrieval' | 'corpus' = ctx ? 'retrieval' : 'corpus';
  if (!ctx) {
    ctx = loadWikiContext(vaultPath, { budgetBytes: budget, includeRaw });
  }

  if (ctx.items.length === 0) {
    throw new Error(
      `The wiki appears empty. Ingest at least one source and run \`obs kb compile\` first.`,
    );
  }

  let rounds = 1;
  let answer = await askOnce(question, ctx, config);

  // Deep mode: one extra retrieval round seeded by what round 1 said the
  // context was missing — then re-answer with the widened context.
  if (opts.deep && contextMode === 'retrieval' && answer.gaps.length > 0) {
    const gapQuery = `${question}\n${answer.gaps.join('\n')}`;
    const extra = await loadRetrievedContext(vaultPath, gapQuery, {
      budgetBytes: Math.floor(budget / 2),
      includeRaw,
      k: opts.retrievalK ?? 12,
      embedFn: opts.embedFn,
      excludePaths: new Set(ctx.items.map(i => i.relPath)),
    });
    if (extra && extra.items.length > 0) {
      ctx = {
        items: [...ctx.items, ...extra.items],
        totalBytes: ctx.totalBytes + extra.totalBytes,
      };
      answer = await askOnce(question, ctx, config);
      rounds = 2;
    }
  }

  const { absPath, relPath } = writeAnswerFile(vaultPath, question, answer);

  if (opts.addBacklinks !== false) {
    const basenameOfAnswer = relPath.split('/').pop()!.replace(/\.md$/, '');
    appendBacklinksToSources(vaultPath, answer, basenameOfAnswer, ctx.items);
  }

  return {
    question,
    answer,
    sourcesConsidered: ctx.items.length,
    contextBytes: ctx.totalBytes,
    contextMode,
    rounds,
    answerPath: relPath,
    answerAbsPath: absPath,
  };
}

async function askOnce(
  question: string,
  ctx: { items: WikiItem[]; totalBytes: number },
  config: LLMConfig,
): Promise<Answer> {
  const contextBlock = ctx.items
    .map(i => `### [[${i.basename}]]\n<!-- path: ${i.relPath} -->\n${i.content}`)
    .join('\n\n---\n\n');

  const prompt = [
    `QUESTION: ${question}`,
    ``,
    `Your job is to answer the question USING ONLY the wiki context below.`,
    `Every factual claim must cite at least one source via [[basename-of-source-file]] wikilinks.`,
    `If the wiki is silent on something, say so in the "gaps" list — do NOT fill in from general knowledge.`,
    ``,
    `=== WIKI CONTEXT (${ctx.items.length} items, ${ctx.totalBytes} bytes) ===`,
    contextBlock,
    `=== END WIKI CONTEXT ===`,
  ].join('\n');

  return llmObject(prompt, AnswerSchema, {
    config,
    system:
      'You are querying a personal compiled knowledge wiki for its owner. Evidence discipline is critical: ' +
      'every claim must trace to a [[wikilink]] source in the provided context. ' +
      'Be terse, specific, and honest about gaps.',
    maxTokens: 5000,
  });
}

// ---- Context loading --------------------------------------------------------

interface WikiItem {
  basename: string;     // filename without .md
  relPath: string;
  absPath: string;
  content: string;      // body only, frontmatter stripped
  mtime: number;
}

/**
 * Retrieval-backed context: hybrid-search the vault, keep the top distinct
 * wiki notes (compiled/ and wiki/; raw/ only when includeRaw), and load
 * their full bodies in rank order until the budget is hit.
 * Returns null when no embedding index exists — the caller falls back to
 * the corpus-in-budget load.
 */
async function loadRetrievedContext(
  vaultPath: string,
  query: string,
  opts: { budgetBytes: number; includeRaw: boolean; k: number; embedFn?: EmbedFn; excludePaths?: Set<string> },
): Promise<{ items: WikiItem[]; totalBytes: number } | null> {
  if (!loadIndex(vaultPath)) return null;

  const vault = new Vault(vaultPath);
  // over-fetch chunks: several chunks may map to the same file, and some
  // paths get filtered out below
  const report = await hybridSearch(vault, query, { mode: 'hybrid', k: opts.k * 4, embedFn: opts.embedFn });

  const allowed = (path: string): boolean => {
    if (path.startsWith('compiled/') || path.startsWith('wiki/')) return true;
    if (opts.includeRaw && path.startsWith('raw/')) return true;
    return false;
  };

  const rankedPaths: string[] = [];
  for (const r of report.results) {
    if (!allowed(r.path)) continue;
    if (opts.excludePaths?.has(r.path)) continue;
    if (!rankedPaths.includes(r.path)) rankedPaths.push(r.path);
    if (rankedPaths.length >= opts.k) break;
  }
  if (rankedPaths.length === 0) return { items: [], totalBytes: 0 };

  const items: WikiItem[] = [];
  let total = 0;
  for (const relPath of rankedPaths) {
    const absPath = join(vaultPath, relPath);
    let raw: string;
    try { raw = readFileSync(absPath, 'utf-8'); } catch { continue; }
    const { content } = matter(raw);
    const basename = relPath.split('/').pop()!.replace(/\.md$/, '');
    const body = content.trim();
    const size = Buffer.byteLength(body, 'utf-8') + Buffer.byteLength(basename, 'utf-8') + 64;
    if (total + size > opts.budgetBytes) break;
    items.push({ basename, relPath, absPath, content: body, mtime: 0 });
    total += size;
  }
  return { items, totalBytes: total };
}

function loadWikiContext(
  vaultPath: string,
  opts: { budgetBytes: number; includeRaw: boolean },
): { items: WikiItem[]; totalBytes: number } {
  const items: WikiItem[] = [];
  const pushFrom = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        pushFrom(full);
      } else if (entry.name.endsWith('.md') && entry.name !== '00-INDEX.md' && entry.name !== 'COMPILE-LOG.md' && entry.name !== 'INGEST-LOG.md') {
        try {
          const raw = readFileSync(full, 'utf-8');
          const { content } = matter(raw);
          const relPath = full.slice(vaultPath.length + 1);
          items.push({
            basename: entry.name.replace(/\.md$/, ''),
            relPath,
            absPath: full,
            content: content.trim(),
            mtime: statSync(full).mtimeMs,
          });
        } catch { /* skip */ }
      }
    }
  };

  pushFrom(compiledDir(vaultPath));
  if (opts.includeRaw) pushFrom(rawDir(vaultPath, ''));

  // Sort newest first so budget-trimming keeps the most current material.
  items.sort((a, b) => b.mtime - a.mtime);

  // Trim to budget
  let total = 0;
  const kept: WikiItem[] = [];
  for (const it of items) {
    const size = Buffer.byteLength(it.content, 'utf-8') + Buffer.byteLength(it.basename, 'utf-8') + 64;
    if (total + size > opts.budgetBytes) break;
    kept.push(it);
    total += size;
  }

  return { items: kept, totalBytes: total };
}

// ---- Output -----------------------------------------------------------------

function writeAnswerFile(
  vaultPath: string,
  question: string,
  answer: Answer,
): { absPath: string; relPath: string } {
  const dir = outputsDir(vaultPath, 'answers');
  mkdirSync(dir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const slug = slugify(answer.restatedQuestion || question, 60);
  const filename = `${date}-${slug}.md`;
  const absPath = join(dir, filename);
  const relPath = join('outputs', 'answers', filename);

  const fm = yamlFrontmatter({
    title: answer.restatedQuestion,
    type: 'answer',
    question,
    asked_at: new Date().toISOString(),
    sources_used: answer.evidence.flatMap(e => e.sources).filter((v, i, a) => a.indexOf(v) === i).length,
    confidence: answer.confidence,
    tags: ['output', 'answer'],
  });

  const body = renderAnswerBody(answer);
  writeFileSync(absPath, `${fm}\n\n${body}\n`, 'utf-8');
  return { absPath, relPath };
}

function renderAnswerBody(answer: Answer): string {
  const parts: string[] = [];
  parts.push(`# ${answer.restatedQuestion}`);
  parts.push('');
  parts.push('## TL;DR');
  for (const b of answer.tldrBullets) parts.push(`- ${b}`);
  parts.push('');
  parts.push('## Detailed answer');
  parts.push(answer.detailedAnswer.trim());
  parts.push('');
  if (answer.evidence.length) {
    parts.push('## Evidence map');
    parts.push('| Claim | Sources |');
    parts.push('|---|---|');
    for (const row of answer.evidence) {
      const src = row.sources.map(s => `[[${s}]]`).join(', ');
      parts.push(`| ${row.claim.replace(/\|/g, '\\|')} | ${src} |`);
    }
    parts.push('');
  }
  if (answer.gaps.length) {
    parts.push('## Gaps (what the vault does NOT cover)');
    for (const g of answer.gaps) parts.push(`- ${g}`);
    parts.push('');
  }
  parts.push(`## Confidence: ${answer.confidence}`);
  parts.push(answer.confidenceReason);
  parts.push('');
  if (answer.relatedNotes.length) {
    parts.push('## Related notes');
    for (const r of answer.relatedNotes) parts.push(`- [[${r}]]`);
    parts.push('');
  }
  return parts.join('\n');
}

function appendBacklinksToSources(
  vaultPath: string,
  answer: Answer,
  answerBasename: string,
  ctx: WikiItem[],
): void {
  const byBasename = new Map(ctx.map(i => [i.basename, i]));
  const cited = new Set(answer.evidence.flatMap(e => e.sources));
  for (const src of cited) {
    const item = byBasename.get(src);
    if (!item) continue;
    const current = readFileSync(item.absPath, 'utf-8');
    const backlinkLine = `- [[${answerBasename}]] — \`${new Date().toISOString().slice(0, 10)}\``;
    if (current.includes(backlinkLine)) continue;
    if (/^##\s+Derived answers\b/m.test(current)) {
      const updated = current.replace(/^##\s+Derived answers\b[\s\S]*?(?=^##\s|\Z)/m, block => {
        return `${block.trimEnd()}\n${backlinkLine}\n\n`;
      });
      writeFileSync(item.absPath, updated, 'utf-8');
    } else {
      appendFileSync(item.absPath, `\n## Derived answers\n${backlinkLine}\n`, 'utf-8');
    }
  }
}
