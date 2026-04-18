import { z } from 'zod';
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { compiledDir, outputsDir } from './paths.js';
import { resolveLLMConfig, llmObject, llmText, type LLMConfig } from './llm.js';
import { yamlFrontmatter, ingestArticle } from './ingest.js';
import { compileKb } from './compile.js';

// ---- Public types -----------------------------------------------------------

export interface AutohuntOptions {
  maxQuestions?: number;
  maxSourcesPerQuestion?: number;
  skipCompile?: boolean;
  config?: LLMConfig;
  onProgress?: (msg: string) => void;
}

export interface HuntedQuestion {
  concept: string;
  question: string;
  searchQueries: string[];
  candidateUrls: string[];
  ingestedPaths: string[];
  skipped: Array<{ url: string; reason: string }>;
}

export interface AutohuntReport {
  questionsCollected: number;
  questionsChosen: number;
  urlsAttempted: number;
  sourcesIngested: number;
  recompiled: boolean;
  digestPath: string;
  details: HuntedQuestion[];
}

export interface CollectedQuestion {
  concept: string;
  question: string;
  sourceConceptPath: string;
}

// ---- Schemas ---------------------------------------------------------------

const RankedQuestionsSchema = z.object({
  ranked: z.array(
    z.object({
      concept: z.string(),
      question: z.string(),
      value: z.number().describe('0-10 score for research value'),
      reasoning: z.string(),
      searchQueries: z.array(z.string()).min(1).max(3),
    }),
  ),
});

const ProposedUrlsSchema = z.object({
  urls: z.array(z.string()).min(0).max(5),
});

// ---- Main entry point ------------------------------------------------------

export async function autohuntKb(vaultPath: string, opts: AutohuntOptions = {}): Promise<AutohuntReport> {
  const maxQuestions = opts.maxQuestions ?? 3;
  const maxSourcesPerQuestion = opts.maxSourcesPerQuestion ?? 3;
  const log = (m: string) => opts.onProgress?.(m);

  const collected = collectOpenQuestions(vaultPath);
  log(`Collected ${collected.length} open question(s) across the wiki.`);

  if (collected.length === 0) {
    const digestPath = writeDigest(vaultPath, {
      questionsCollected: 0,
      chosen: [],
      details: [],
      recompiled: false,
      fellBackToLLMUrls: false,
      compileError: null,
    });
    return {
      questionsCollected: 0,
      questionsChosen: 0,
      urlsAttempted: 0,
      sourcesIngested: 0,
      recompiled: false,
      digestPath,
      details: [],
    };
  }

  const config = opts.config ?? resolveLLMConfig();

  log('Ranking questions and generating search queries...');
  let ranked: Array<{ concept: string; question: string; value: number; reasoning: string; searchQueries: string[] }>;
  try {
    const out = await llmObject(
      buildRankPrompt(collected, maxQuestions),
      RankedQuestionsSchema,
      {
        config,
        system:
          'You are a research planner. Rank open research questions by their likely value ' +
          '(novelty, specificity, whether web search can plausibly answer them). Generate ' +
          'targeted web search queries for each top question.',
        maxTokens: 2000,
      },
    );
    ranked = out.ranked.slice(0, maxQuestions);
  } catch (err) {
    log(`LLM ranking failed: ${(err as Error).message.slice(0, 200)}; falling back to first N.`);
    ranked = collected.slice(0, maxQuestions).map(q => ({
      concept: q.concept,
      question: q.question,
      value: 5,
      reasoning: 'fallback (no ranking)',
      searchQueries: buildSearchQueries(q.question, q.concept),
    }));
  }

  const details: HuntedQuestion[] = [];
  let urlsAttempted = 0;
  let sourcesIngested = 0;
  let fellBackToLLMUrls = false;

  for (const r of ranked) {
    log(`Hunting: [[${r.concept}]] — "${r.question}"`);
    const candidateUrls: string[] = [];
    for (const query of r.searchQueries) {
      const fromSearch = await searchDuckDuckGo(query).catch(() => null);
      if (fromSearch && fromSearch.length) {
        candidateUrls.push(...fromSearch);
      } else {
        fellBackToLLMUrls = true;
        const fallback = await proposeUrlsViaLLM(query, config).catch(() => []);
        candidateUrls.push(...fallback);
      }
    }
    const uniqueUrls = dedupeUrls(candidateUrls).slice(0, maxSourcesPerQuestion);
    urlsAttempted += uniqueUrls.length;

    const ingestedPaths: string[] = [];
    const skipped: Array<{ url: string; reason: string }> = [];
    for (const url of uniqueUrls) {
      try {
        const result = await ingestArticle(vaultPath, url);
        if (result.duplicate) {
          skipped.push({ url, reason: 'duplicate' });
        } else {
          ingestedPaths.push(result.path);
          sourcesIngested += 1;
        }
      } catch (err) {
        skipped.push({ url, reason: (err as Error).message.slice(0, 200) });
      }
    }

    details.push({
      concept: r.concept,
      question: r.question,
      searchQueries: r.searchQueries,
      candidateUrls: uniqueUrls,
      ingestedPaths,
      skipped,
    });
  }

  let recompiled = false;
  let compileError: string | null = null;
  if (!opts.skipCompile && sourcesIngested > 0) {
    try {
      log('Recompiling...');
      await compileKb(vaultPath, { config, onProgress: opts.onProgress });
      recompiled = true;
    } catch (err) {
      compileError = (err as Error).message.slice(0, 300);
      log(`Compile failed: ${compileError}`);
    }
  }

  const digestPath = writeDigest(vaultPath, {
    questionsCollected: collected.length,
    chosen: ranked,
    details,
    recompiled,
    fellBackToLLMUrls,
    compileError,
  });

  return {
    questionsCollected: collected.length,
    questionsChosen: ranked.length,
    urlsAttempted,
    sourcesIngested,
    recompiled,
    digestPath,
    details,
  };
}

// ---- Pure helpers ----------------------------------------------------------

/**
 * Walk compiled markdown files, pull bullet items under any `## Open questions`
 * heading, and flatten them into {concept, question, sourceConceptPath} rows.
 * Returns [] if the compiled directory is missing.
 */
export function collectOpenQuestions(vaultPath: string): CollectedQuestion[] {
  const root = compiledDir(vaultPath);
  if (!existsSync(root)) return [];
  const out: CollectedQuestion[] = [];
  for (const abs of walkMarkdownFiles(root)) {
    const raw = readFileSync(abs, 'utf-8');
    const questions = extractOpenQuestionsSection(raw);
    if (questions.length === 0) continue;
    const concept = abs.split('/').pop()!.replace(/\.md$/, '');
    const relPath = abs.startsWith(vaultPath) ? abs.slice(vaultPath.length).replace(/^\/+/, '') : abs;
    for (const q of questions) {
      out.push({ concept, question: q, sourceConceptPath: relPath });
    }
  }
  return out;
}

/**
 * Build 2-3 plausible web search queries for a (question, concept) pair.
 * Pure; no LLM or network. Used as a fallback and by unit tests.
 */
export function buildSearchQueries(question: string, concept: string): string[] {
  const cleanQ = question.trim().replace(/^[-*+]\s+/, '').replace(/\s+/g, ' ');
  const cleanC = concept.trim().replace(/-/g, ' ');
  const q1 = cleanQ;
  const q2 = `${cleanC} ${stripQuestionWords(cleanQ)}`.trim().replace(/\s+/g, ' ');
  const q3 = `"${cleanC}" ${extractKeyPhrase(cleanQ)}`.trim().replace(/\s+/g, ' ');
  const list = [q1, q2, q3].filter(s => s.length > 0);
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const s of list) {
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(s);
  }
  return deduped.slice(0, 3);
}

// ---- Internal helpers ------------------------------------------------------

function walkMarkdownFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkMarkdownFiles(abs));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(abs);
    }
  }
  return out;
}

/**
 * Pull top-level bullet items from a `## Open questions` section. The section
 * ends at the next `##` heading or end of file. Only top-level bullets
 * (`-`, `*`, `+` at column 0) are returned — nested bullets are ignored to
 * keep questions tidy.
 */
export function extractOpenQuestionsSection(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  let inSection = false;
  const results: string[] = [];
  for (const line of lines) {
    if (/^##\s+Open questions\b/i.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^##\s+/.test(line)) break;
    if (!inSection) continue;
    const m = line.match(/^[-*+]\s+(.+?)\s*$/);
    if (m) {
      const text = m[1].trim();
      if (text) results.push(text);
    }
  }
  return results;
}

function stripQuestionWords(q: string): string {
  return q
    .replace(/^(what|why|how|when|where|who|which|is|are|does|do|can|should|will)\s+/i, '')
    .replace(/\?+\s*$/, '')
    .trim();
}

function extractKeyPhrase(q: string): string {
  const stripped = stripQuestionWords(q);
  const words = stripped.split(/\s+/).filter(Boolean);
  return words.slice(0, 6).join(' ');
}

function buildRankPrompt(questions: CollectedQuestion[], maxQuestions: number): string {
  const lines = questions.map((q, i) => `${i + 1}. [${q.concept}] ${q.question}`);
  return [
    `We have ${questions.length} open questions from a personal knowledge wiki.`,
    `Pick the top ${maxQuestions} by research value (novelty, specificity, likely answerable by web search).`,
    `For each chosen question, generate 1-3 focused web search queries.`,
    ``,
    `QUESTIONS:`,
    ...lines,
  ].join('\n');
}

async function proposeUrlsViaLLM(query: string, config: LLMConfig): Promise<string[]> {
  try {
    const out = await llmObject(
      `Propose up to 3 plausible public URLs that likely answer this web search query: "${query}". ` +
        `Prefer authoritative sources (Wikipedia, arxiv, primary docs, well-known blogs). ` +
        `Return only the URLs.`,
      ProposedUrlsSchema,
      { config, maxTokens: 500 },
    );
    return out.urls.filter(u => /^https?:\/\//i.test(u));
  } catch {
    return [];
  }
}

/**
 * Fetch DuckDuckGo HTML results page and parse candidate URLs via regex.
 * Unwraps `/l/?uddg=<encoded>` redirects to the real target. Throws on any
 * HTTP failure so the caller can decide to fall back.
 */
export async function searchDuckDuckGo(query: string): Promise<string[]> {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
      accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  const html = await res.text();
  return parseDuckDuckGoResults(html);
}

export function parseDuckDuckGoResults(html: string): string[] {
  const urls: string[] = [];
  const anchorRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRegex.exec(html)) !== null) {
    const raw = decodeHtmlEntities(m[1]);
    const resolved = unwrapDuckDuckGoRedirect(raw);
    if (resolved) urls.push(resolved);
  }
  const alt = /<a[^>]*href="([^"]+)"[^>]*class="[^"]*result__a[^"]*"/gi;
  while ((m = alt.exec(html)) !== null) {
    const raw = decodeHtmlEntities(m[1]);
    const resolved = unwrapDuckDuckGoRedirect(raw);
    if (resolved) urls.push(resolved);
  }
  return dedupeUrls(urls);
}

export function unwrapDuckDuckGoRedirect(href: string): string | null {
  let h = href.trim();
  if (!h) return null;
  if (h.startsWith('//')) h = `https:${h}`;
  const redirectMatch = h.match(/[?&]uddg=([^&]+)/i);
  if (redirectMatch) {
    try {
      return decodeURIComponent(redirectMatch[1]);
    } catch {
      return null;
    }
  }
  if (/^https?:\/\//i.test(h)) return h;
  return null;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const junkDomains = /(^|\.)(pinterest|quora)\.[a-z.]+$/i;
  for (const raw of urls) {
    if (!raw || !/^https?:\/\//i.test(raw)) continue;
    let canonical: string;
    try {
      const u = new URL(raw);
      u.hash = '';
      const trackers = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'rut'];
      for (const t of trackers) u.searchParams.delete(t);
      canonical = u.toString();
      if (junkDomains.test(u.hostname)) continue;
    } catch {
      continue;
    }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return out;
}

// ---- Digest writer ---------------------------------------------------------

interface DigestInput {
  questionsCollected: number;
  chosen: Array<{ concept: string; question: string; value: number; reasoning: string; searchQueries: string[] }>;
  details: HuntedQuestion[];
  recompiled: boolean;
  fellBackToLLMUrls: boolean;
  compileError: string | null;
}

function writeDigest(vaultPath: string, input: DigestInput): string {
  const dateStr = new Date().toISOString().slice(0, 10);
  const dir = outputsDir(vaultPath, 'autohunt');
  mkdirSync(dir, { recursive: true });
  const digestPath = join(dir, `${dateStr}.md`);

  const sourcesIngested = input.details.reduce((n, d) => n + d.ingestedPaths.length, 0);
  const fm = yamlFrontmatter({
    title: `Autohunt Digest — ${dateStr}`,
    type: 'autohunt-digest',
    questions_collected: input.questionsCollected,
    questions_chosen: input.chosen.length,
    sources_ingested: sourcesIngested,
    recompiled: input.recompiled,
    tags: ['output', 'autohunt'],
  });

  const lines: string[] = [
    fm,
    '',
    `# Autohunt Digest — ${dateStr}`,
    '',
    '## Summary',
    `- Collected ${input.questionsCollected} open question(s) across the wiki.`,
    `- Hunted ${input.chosen.length} of them.`,
    `- Ingested ${sourcesIngested} new source(s).`,
    `- Recompile: ${input.recompiled ? 'yes' : 'no'}${input.compileError ? ` (error: ${input.compileError})` : ''}.`,
  ];
  if (input.fellBackToLLMUrls) {
    lines.push('- Note: DuckDuckGo search failed for one or more queries; fell back to LLM-proposed URLs.');
  }
  lines.push('');

  if (input.details.length === 0) {
    lines.push('No open questions to hunt. Run `obs kb compile` first, or add questions manually.', '');
  } else {
    lines.push('## Per-question breakdown', '');
    for (const d of input.details) {
      lines.push(`### [[${d.concept}]] — "${d.question}"`);
      lines.push(`- Search queries: ${d.searchQueries.map(q => `"${q}"`).join(', ')}`);
      lines.push(`- Candidate URLs (${d.candidateUrls.length} attempted):`);
      for (const u of d.candidateUrls) lines.push(`  - ${u}`);
      if (d.ingestedPaths.length) {
        lines.push(`- Ingested:`);
        for (const p of d.ingestedPaths) lines.push(`  - ${p}`);
      } else {
        lines.push(`- Ingested: none`);
      }
      if (d.skipped.length) {
        lines.push(`- Skipped:`);
        for (const s of d.skipped) lines.push(`  - ${s.url} (${s.reason})`);
      }
      lines.push('');
    }
  }

  lines.push('## Next actions');
  if (input.details.length > 0) {
    const firstQ = input.details[0].question;
    lines.push('- Re-run after morning coffee.');
    lines.push(`- Consider \`/ask "${firstQ}"\` to synthesise the freshly-ingested material.`);
  } else {
    lines.push('- Compile the wiki first so questions can be collected.');
  }
  lines.push('');

  writeFileSync(digestPath, lines.join('\n'), 'utf-8');
  return digestPath;
}

// Keep llmText imported for future narrative summaries without triggering
// unused-import warnings under strict TS.
void llmText;
