import { z } from 'zod';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  appendFileSync,
} from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

import { outputsDir } from './paths.js';
import { resolveLLMConfig, llmObject, type LLMConfig } from './llm.js';
import { yamlFrontmatter } from './ingest.js';
import { askKb } from './ask.js';

// ---- Public types -----------------------------------------------------------

export interface EvalOptions {
  samples?: number;
  seed?: number;
  config?: LLMConfig;
  onProgress?: (msg: string) => void;
}

export interface QaPair {
  sourcePath: string;
  question: string;
  goldAnswer: string;
  expectedCitations: string[];
}

export interface ScoredPair extends QaPair {
  actualAnswer: string;
  actualCitations: string[];
  verdict: 'correct' | 'partial' | 'wrong';
  reason: string;
}

export interface EvalReport {
  samples: number;
  correct: number;
  partial: number;
  wrong: number;
  iqScore: number;
  citationPrecision: number;
  citationRecall: number;
  pairs: ScoredPair[];
  reportPath: string;
  trendPath: string;
}

// ---- Schemas ----------------------------------------------------------------

const QaGenSchema = z.object({
  pairs: z
    .array(
      z.object({
        question: z.string(),
        goldAnswer: z.string(),
        confidence: z
          .enum(['high', 'medium'])
          .describe('Only include high/medium — skip anything ambiguous'),
      }),
    )
    .min(1)
    .max(5),
});

const VerdictSchema = z.object({
  contentMatch: z.enum(['full', 'partial', 'none']),
  reason: z.string(),
});

// ---- Pure helpers -----------------------------------------------------------

/**
 * Deterministic seeded PRNG (mulberry32). Same (seed, input) => same output.
 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Reproducibly sample up to n unique items from `allSources` using `seed`.
 * If n >= allSources.length, returns a shuffled copy of all items.
 */
export function pickSampleSources(allSources: string[], n: number, seed: number): string[] {
  const rand = mulberry32(seed);
  const copy = [...allSources];
  // Fisher-Yates with seeded rand
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  if (n >= copy.length) return copy;
  return copy.slice(0, Math.max(0, n));
}

/**
 * Compute citation precision and recall, guarding against divide-by-zero.
 * Precision: of cited sources, how many were expected.
 * Recall: of expected sources, how many were actually cited.
 */
export function computeCitationMetrics(
  expected: string[],
  actual: string[],
): { precision: number; recall: number } {
  const expSet = new Set(expected);
  const actSet = new Set(actual);
  const hits = [...actSet].filter(x => expSet.has(x)).length;
  const precision = actSet.size === 0 ? 0 : hits / actSet.size;
  const recall = expSet.size === 0 ? 1 : hits / expSet.size;
  return { precision, recall };
}

// ---- Filesystem helpers -----------------------------------------------------

interface RawSource {
  basename: string;
  absPath: string;
  relPath: string;
  content: string;
}

function listRawSources(vaultPath: string): RawSource[] {
  const out: RawSource[] = [];
  const rootRaw = join(vaultPath, 'raw');
  if (!existsSync(rootRaw)) return out;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (
        entry.name.endsWith('.md') &&
        entry.name !== 'INGEST-LOG.md' &&
        entry.name !== '00-INDEX.md'
      ) {
        try {
          const raw = readFileSync(full, 'utf-8');
          const { content } = matter(raw);
          if (content.trim().length < 100) continue; // skip stubs
          out.push({
            basename: entry.name.replace(/\.md$/, ''),
            absPath: full,
            relPath: full.slice(vaultPath.length + 1),
            content: content.trim(),
          });
        } catch {
          /* skip */
        }
      }
    }
  };
  walk(rootRaw);
  return out;
}

// ---- LLM tasks --------------------------------------------------------------

async function generateQaForSource(
  source: RawSource,
  config: LLMConfig,
): Promise<QaPair[]> {
  // Cap content to keep prompts bounded.
  const body = source.content.slice(0, 12_000);
  const prompt = [
    `SOURCE BASENAME: ${source.basename}`,
    ``,
    `Generate 1-3 factual, unambiguous Q/A pairs strictly answerable from the SOURCE TEXT below.`,
    `Rules:`,
    `- The answer must be a short, concrete string present (or trivially paraphrased) in the source.`,
    `- Skip anything subjective or ambiguous.`,
    `- Do NOT reference "the source" or "the article" in the question — phrase as a standalone question.`,
    `- "confidence" must be "high" or "medium"; skip low-confidence candidates entirely.`,
    ``,
    `=== SOURCE TEXT ===`,
    body,
    `=== END SOURCE TEXT ===`,
  ].join('\n');

  const result = await llmObject(prompt, QaGenSchema, {
    config,
    system:
      'You are a rigorous eval Q/A generator for a personal knowledge wiki. ' +
      'Produce questions that have a single defensible short answer directly in the source.',
    maxTokens: 1500,
  });

  return result.pairs.map(p => ({
    sourcePath: source.basename,
    question: p.question,
    goldAnswer: p.goldAnswer,
    expectedCitations: [source.basename],
  }));
}

async function judgeAnswer(
  pair: QaPair,
  actualAnswer: string,
  config: LLMConfig,
): Promise<z.infer<typeof VerdictSchema>> {
  // Fast path: direct substring match (case-insensitive, whitespace-normalized).
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  if (norm(actualAnswer).includes(norm(pair.goldAnswer)) && pair.goldAnswer.length > 0) {
    return { contentMatch: 'full', reason: 'gold substring present in actual answer' };
  }

  const prompt = [
    `QUESTION: ${pair.question}`,
    `GOLD ANSWER: ${pair.goldAnswer}`,
    `ACTUAL ANSWER: ${actualAnswer}`,
    ``,
    `Does the ACTUAL ANSWER contain the GOLD ANSWER — either verbatim or as a clear semantic equivalent?`,
    `- "full": the actual answer asserts the gold fact unambiguously.`,
    `- "partial": the actual answer is related but hedged, incomplete, or slightly off.`,
    `- "none": the actual answer contradicts or is unrelated.`,
  ].join('\n');

  return llmObject(prompt, VerdictSchema, {
    config,
    system:
      'You grade wiki answers for factual alignment with a gold reference. Be strict but fair; ' +
      'semantic equivalence counts as full match.',
    maxTokens: 400,
  });
}

// ---- Verdict logic ----------------------------------------------------------

function combineVerdict(
  contentMatch: 'full' | 'partial' | 'none',
  citationHit: boolean,
): 'correct' | 'partial' | 'wrong' {
  if (contentMatch === 'full' && citationHit) return 'correct';
  if (contentMatch === 'none' && !citationHit) return 'wrong';
  return 'partial';
}

// ---- Extract citations from structured answer -------------------------------

function citationsFromAnswer(evidence: { sources: string[] }[]): string[] {
  const out = new Set<string>();
  for (const row of evidence) {
    for (const s of row.sources) out.add(s);
  }
  return [...out];
}

// ---- Report rendering -------------------------------------------------------

function renderReport(
  date: string,
  report: Omit<EvalReport, 'reportPath' | 'trendPath'>,
): string {
  const fm = yamlFrontmatter({
    title: `Eval Report — ${date}`,
    type: 'eval-report',
    samples: report.samples,
    iq_score: round2(report.iqScore),
    citation_precision: round2(report.citationPrecision),
    citation_recall: round2(report.citationRecall),
    tags: ['output', 'eval'],
  });

  const lines: string[] = [];
  lines.push(`# Eval Report — ${date}`);
  lines.push('');
  lines.push('## Summary');
  lines.push(`- Samples: ${report.samples}`);
  lines.push(`- Correct: ${report.correct} (IQ: ${round2(report.iqScore)})`);
  lines.push(`- Partial: ${report.partial}`);
  lines.push(`- Wrong: ${report.wrong}`);
  lines.push(`- Citation precision: ${round2(report.citationPrecision)}`);
  lines.push(`- Citation recall: ${round2(report.citationRecall)}`);
  lines.push('');

  const bad = report.pairs.filter(p => p.verdict !== 'correct');
  if (bad.length) {
    lines.push('## Wrong / partial details');
    for (const p of bad) {
      lines.push(`### Q: "${p.question}"`);
      lines.push(`- Source: [[${p.sourcePath}]]`);
      lines.push(`- Gold answer: "${truncate(p.goldAnswer, 280)}"`);
      lines.push(`- Actual answer: "${truncate(p.actualAnswer, 400)}"`);
      const cits = p.actualCitations.length
        ? p.actualCitations.map(c => `[[${c}]]`).join(', ')
        : '(none)';
      lines.push(`- Citations: ${cits}`);
      lines.push(`- Verdict: ${p.verdict}`);
      lines.push(`- Reason: ${p.reason}`);
      lines.push('');
    }
  }

  lines.push('## Suggestions');
  const suggestions = suggest(report);
  for (const s of suggestions) lines.push(`- ${s}`);
  lines.push('');

  return `${fm}\n\n${lines.join('\n')}\n`;
}

function suggest(r: Omit<EvalReport, 'reportPath' | 'trendPath'>): string[] {
  const out: string[] = [];
  if (r.iqScore < 0.6) {
    out.push('IQ below 0.6 — compiled concepts may be too sparse; re-run `obs kb compile` or ingest more sources.');
  }
  if (r.citationRecall < 0.7) {
    out.push('Citation recall low — answers are not consistently citing the original source; inspect ask.ts prompt discipline.');
  }
  if (r.citationPrecision < 0.7) {
    out.push('Citation precision low — answers cite unrelated sources; review context-budget trimming in ask.ts.');
  }
  if (r.partial > r.correct) {
    out.push('Partial > correct — either gold answers are too specific, or citation mapping is drifting.');
  }
  if (out.length === 0) out.push('No major regressions. Keep an eye on the TREND log.');
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function truncate(s: string, n: number): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > n ? clean.slice(0, n - 1) + '…' : clean;
}

function appendTrend(
  trendAbsPath: string,
  date: string,
  r: Omit<EvalReport, 'reportPath' | 'trendPath'>,
): void {
  const header = '# Eval Trend (append-only)\n\ndate,samples,correct,partial,wrong,iq_score,citation_precision,citation_recall\n';
  if (!existsSync(trendAbsPath)) {
    writeFileSync(trendAbsPath, header, 'utf-8');
  }
  const row = [
    date,
    r.samples,
    r.correct,
    r.partial,
    r.wrong,
    round2(r.iqScore),
    round2(r.citationPrecision),
    round2(r.citationRecall),
  ].join(',');
  appendFileSync(trendAbsPath, `${row}\n`, 'utf-8');
}

// ---- Main entry -------------------------------------------------------------

export async function evalKb(vaultPath: string, opts: EvalOptions = {}): Promise<EvalReport> {
  const config = opts.config ?? resolveLLMConfig();
  const samples = opts.samples ?? 20;
  const seed = opts.seed ?? 1;
  const progress = opts.onProgress ?? (() => {});

  const allSources = listRawSources(vaultPath);
  if (allSources.length === 0) {
    throw new Error(
      'No raw sources found. Run `obs kb ingest <url>` at least once before evaluating.',
    );
  }

  const basenames = allSources.map(s => s.basename);
  const sampled = pickSampleSources(basenames, samples, seed);
  const byBasename = new Map(allSources.map(s => [s.basename, s]));

  progress(`Generating Q/A pairs for ${sampled.length} source(s)...`);

  const qaPairs: QaPair[] = [];
  for (const name of sampled) {
    const src = byBasename.get(name);
    if (!src) continue;
    try {
      const pairs = await generateQaForSource(src, config);
      // Keep first pair per source to bound total eval calls.
      if (pairs.length > 0) qaPairs.push(pairs[0]!);
      progress(`  qa: ${name} (+${pairs.length})`);
    } catch (err) {
      progress(`  qa-fail: ${name} (${(err as Error).message})`);
    }
  }

  if (qaPairs.length === 0) {
    throw new Error('Q/A generation produced no pairs; aborting eval.');
  }

  progress(`Scoring ${qaPairs.length} pair(s) against askKb...`);

  const scored: ScoredPair[] = [];
  let citeHits = 0;
  let citeTotalActual = 0;
  let citeTotalExpected = 0;
  let citeCoveredExpected = 0;

  for (const pair of qaPairs) {
    try {
      const res = await askKb(vaultPath, pair.question, {
        config,
        addBacklinks: false, // keep eval side-effects minimal — no backlinks
      });
      const actualAnswerText = [
        res.answer.restatedQuestion,
        ...res.answer.tldrBullets,
        res.answer.detailedAnswer,
      ]
        .join('\n');
      const actualCitations = citationsFromAnswer(res.answer.evidence);
      const verdictObj = await judgeAnswer(pair, actualAnswerText, config);
      const citationHit = pair.expectedCitations.some(c => actualCitations.includes(c));
      const verdict = combineVerdict(verdictObj.contentMatch, citationHit);

      // Aggregate citation metrics (per-pair precision/recall averaged later).
      const m = computeCitationMetrics(pair.expectedCitations, actualCitations);
      citeTotalActual += actualCitations.length;
      citeHits += actualCitations.filter(c => pair.expectedCitations.includes(c)).length;
      citeTotalExpected += pair.expectedCitations.length;
      citeCoveredExpected += pair.expectedCitations.filter(c =>
        actualCitations.includes(c),
      ).length;

      scored.push({
        ...pair,
        actualAnswer: actualAnswerText,
        actualCitations,
        verdict,
        reason: verdictObj.reason + (citationHit ? '' : ' | citation miss'),
      });
      progress(`  score: ${pair.sourcePath} => ${verdict} (cp=${round2(m.precision)} cr=${round2(m.recall)})`);
    } catch (err) {
      scored.push({
        ...pair,
        actualAnswer: '',
        actualCitations: [],
        verdict: 'wrong',
        reason: `ask error: ${(err as Error).message}`,
      });
      progress(`  score-fail: ${pair.sourcePath} (${(err as Error).message})`);
    }
  }

  const correct = scored.filter(s => s.verdict === 'correct').length;
  const partial = scored.filter(s => s.verdict === 'partial').length;
  const wrong = scored.filter(s => s.verdict === 'wrong').length;
  const total = scored.length;

  const iqScore = total === 0 ? 0 : correct / total;
  const citationPrecision = citeTotalActual === 0 ? 0 : citeHits / citeTotalActual;
  const citationRecall = citeTotalExpected === 0 ? 1 : citeCoveredExpected / citeTotalExpected;

  const date = new Date().toISOString().slice(0, 10);
  const evalDir = outputsDir(vaultPath, 'eval');
  mkdirSync(evalDir, { recursive: true });
  const reportAbs = join(evalDir, `${date}.md`);
  const trendAbs = join(evalDir, 'TREND.md');

  const payload: Omit<EvalReport, 'reportPath' | 'trendPath'> = {
    samples: total,
    correct,
    partial,
    wrong,
    iqScore,
    citationPrecision,
    citationRecall,
    pairs: scored,
  };

  writeFileSync(reportAbs, renderReport(date, payload), 'utf-8');
  appendTrend(trendAbs, date, payload);

  const reportPath = join('outputs', 'eval', `${date}.md`);
  const trendPath = join('outputs', 'eval', 'TREND.md');

  progress(
    `Eval complete: ${correct}/${total} correct (IQ ${round2(iqScore)}), report at ${reportPath}`,
  );

  return { ...payload, reportPath, trendPath };
}

