import { z } from 'zod';
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

import { compiledDir, rawDir, outputsDir } from './paths.js';
import { resolveLLMConfig, llmObject, type LLMConfig } from './llm.js';
import { yamlFrontmatter, slugify } from './ingest.js';

export interface VerifyOptions {
  concept?: string;
  all?: boolean;
  annotate?: boolean;
  config?: LLMConfig;
  onProgress?: (msg: string) => void;
}

export interface VerifyReport {
  conceptsScanned: number;
  claimsChecked: number;
  supported: number;
  partial: number;
  unsupported: number;
  missingSource: number;
  reportPaths: string[];
  annotatedConceptPaths: string[];
}

export type VerdictKind = 'verified' | 'partial' | 'unverified' | 'missing-source';

const ClaimVerdictSchema = z.object({
  verdicts: z.array(
    z.object({
      claimIndex: z.number(),
      verdict: z.enum(['supported', 'partial', 'unsupported']),
      reason: z.string(),
      bestQuoteFromSource: z.string().optional(),
    }),
  ),
});

type ClaimVerdicts = z.infer<typeof ClaimVerdictSchema>;

export interface ExtractedClaim {
  text: string;
  citedSources: string[];
  line: number;
}

const RAW_DIRS = ['articles', 'papers', 'repos', 'transcripts'] as const;

export function extractClaims(body: string): ExtractedClaim[] {
  const lines = body.split(/\r?\n/);
  const section = findSection(lines, /^##\s+Key claims\b/i);
  const target = section ?? findSection(lines, /^##\s+Sources\b/i) ?? { start: 0, end: lines.length };

  const claims: ExtractedClaim[] = [];
  for (let i = target.start; i < target.end; i++) {
    const raw = lines[i];
    const m = raw.match(/^(\s*)-\s+(.*\S)\s*$/);
    if (!m) continue;
    const text = m[2];
    const citedSources = extractWikilinks(text);
    claims.push({ text, citedSources, line: i });
  }
  return claims;
}

export function renderVerifyCallout(kind: VerdictKind, reason: string): string {
  const safe = reason.replace(/\r?\n/g, ' ').trim() || kindDefaultReason(kind);
  return `> [!${kind}] ${safe}`;
}

export function extractWikilinks(text: string): string[] {
  const out: string[] = [];
  const re = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = m[1].trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

function kindDefaultReason(kind: VerdictKind): string {
  switch (kind) {
    case 'verified': return 'Source supports this claim.';
    case 'partial': return 'Source partially supports this claim.';
    case 'unverified': return 'Source does not support this claim.';
    case 'missing-source': return 'Claim has no cited source.';
  }
}

function findSection(lines: string[], headingRe: RegExp): { start: number; end: number } | null {
  const startIdx = lines.findIndex(l => headingRe.test(l));
  if (startIdx < 0) return null;
  let end = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s+\S/.test(lines[i])) { end = i; break; }
  }
  return { start: startIdx + 1, end };
}

function verdictToKind(v: 'supported' | 'partial' | 'unsupported'): VerdictKind {
  return v === 'supported' ? 'verified' : v === 'unsupported' ? 'unverified' : 'partial';
}

export function findRawSourcePath(vaultPath: string, basename: string): string | null {
  const name = basename.endsWith('.md') ? basename : `${basename}.md`;
  for (const sub of RAW_DIRS) {
    const candidate = join(rawDir(vaultPath, sub), name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function annotateBody(
  body: string,
  annotations: Array<{ line: number; indent: string; callout: string }>,
): string {
  const lines = body.split(/\r?\n/);
  const sorted = [...annotations].sort((a, b) => b.line - a.line);
  for (const ann of sorted) {
    const next = lines[ann.line + 1] ?? '';
    const calloutLine = `${ann.indent}${ann.callout}`;
    if (/^\s*>\s*\[!(verified|partial|unverified|missing-source)\]/.test(next)) {
      lines[ann.line + 1] = calloutLine;
    } else {
      lines.splice(ann.line + 1, 0, calloutLine);
    }
  }
  return lines.join('\n');
}

export async function verifyKb(vaultPath: string, opts: VerifyOptions): Promise<VerifyReport> {
  const config = opts.config ?? resolveLLMConfig();
  const annotate = opts.annotate !== false;
  const log = (msg: string) => opts.onProgress?.(msg);

  const targets = resolveTargets(vaultPath, opts);
  log(`Scanning ${targets.length} concept page(s).`);

  const report: VerifyReport = {
    conceptsScanned: 0,
    claimsChecked: 0,
    supported: 0,
    partial: 0,
    unsupported: 0,
    missingSource: 0,
    reportPaths: [],
    annotatedConceptPaths: [],
  };

  for (const conceptPath of targets) {
    log(`Verifying ${conceptPath}`);
    const result = await verifyOneConcept(vaultPath, conceptPath, config, annotate);
    report.conceptsScanned += 1;
    report.claimsChecked += result.claimsChecked;
    report.supported += result.supported;
    report.partial += result.partial;
    report.unsupported += result.unsupported;
    report.missingSource += result.missingSource;
    if (result.reportPath) report.reportPaths.push(result.reportPath);
    if (result.annotated) report.annotatedConceptPaths.push(conceptPath);
  }

  return report;
}

function resolveTargets(vaultPath: string, opts: VerifyOptions): string[] {
  if (opts.all) {
    const dir = compiledDir(vaultPath, 'concepts');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter(f => f.endsWith('.md'))
      .map(f => join(dir, f));
  }
  if (!opts.concept) {
    throw new Error('verifyKb requires either opts.concept or opts.all.');
  }
  if (opts.concept.startsWith('/') || opts.concept.includes('\\')) {
    if (!existsSync(opts.concept)) throw new Error(`Concept page not found: ${opts.concept}`);
    return [opts.concept];
  }
  const slug = opts.concept.endsWith('.md') ? opts.concept : `${slugify(opts.concept, 80)}.md`;
  const abs = join(compiledDir(vaultPath, 'concepts'), slug);
  if (!existsSync(abs)) throw new Error(`Concept page not found: ${abs}`);
  return [abs];
}

interface OneConceptResult {
  claimsChecked: number;
  supported: number;
  partial: number;
  unsupported: number;
  missingSource: number;
  reportPath: string | null;
  annotated: boolean;
}

async function verifyOneConcept(
  vaultPath: string,
  conceptAbsPath: string,
  config: LLMConfig,
  annotate: boolean,
): Promise<OneConceptResult> {
  const raw = readFileSync(conceptAbsPath, 'utf-8');
  const parsed = matter(raw);
  const body = parsed.content;
  const conceptTitle = typeof parsed.data.title === 'string'
    ? parsed.data.title
    : conceptAbsPath.split('/').pop()?.replace(/\.md$/, '') ?? 'concept';
  const conceptBasename = conceptAbsPath.split('/').pop()?.replace(/\.md$/, '') ?? 'concept';

  const claims = extractClaims(body);
  const result: OneConceptResult = {
    claimsChecked: 0,
    supported: 0,
    partial: 0,
    unsupported: 0,
    missingSource: 0,
    reportPath: null,
    annotated: false,
  };

  const annotations: Array<{ line: number; indent: string; callout: string }> = [];
  const flagged: Array<{ text: string; verdict: VerdictKind; reason: string; citedSources: string[] }> = [];

  const bySource = new Map<string, number[]>();
  for (let i = 0; i < claims.length; i++) {
    const c = claims[i];
    if (c.citedSources.length === 0) {
      annotations.push({
        line: c.line,
        indent: getIndent(body, c.line),
        callout: renderVerifyCallout('missing-source', 'Claim has no cited source.'),
      });
      flagged.push({ text: c.text, verdict: 'missing-source', reason: 'Claim has no cited source.', citedSources: [] });
      result.missingSource += 1;
      result.claimsChecked += 1;
      continue;
    }
    const key = [...c.citedSources].sort().join('\n');
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key)!.push(i);
  }

  for (const [key, indices] of bySource) {
    const sourceBasenames = key.split('\n').filter(Boolean);
    const loaded = sourceBasenames.map(bn => ({
      basename: bn,
      path: findRawSourcePath(vaultPath, bn),
    }));
    const missing = loaded.filter(s => !s.path);
    if (missing.length === loaded.length) {
      for (const idx of indices) {
        const c = claims[idx];
        const reason = `Cited source(s) not found in raw/: ${missing.map(m => m.basename).join(', ')}`;
        annotations.push({
          line: c.line,
          indent: getIndent(body, c.line),
          callout: renderVerifyCallout('unverified', reason),
        });
        flagged.push({ text: c.text, verdict: 'unverified', reason, citedSources: c.citedSources });
        result.unsupported += 1;
        result.claimsChecked += 1;
      }
      continue;
    }

    const sourceTexts = loaded
      .filter(s => s.path)
      .map(s => {
        const text = readFileSync(s.path!, 'utf-8');
        const stripped = matter(text).content;
        return `### [[${s.basename}]]\n${truncate(stripped, 40_000)}`;
      })
      .join('\n\n---\n\n');

    const subset = indices.map(i => claims[i]);
    const prompt = buildVerifyPrompt(conceptTitle, subset, sourceTexts);

    let verdicts: ClaimVerdicts;
    try {
      verdicts = await llmObject(prompt, ClaimVerdictSchema, {
        config,
        system:
          "You are fact-checking a personal knowledge wiki. Given a concept page's claims and the raw source(s) they cite, decide for each claim whether the cited source supports it. Be strict — use 'partial' when the source touches the claim but doesn't fully support it, and 'unsupported' when the source doesn't mention it. Always return a verdict for every claim index.",
        maxTokens: 3000,
      });
    } catch (err) {
      for (const idx of indices) {
        const c = claims[idx];
        const reason = `LLM verify error: ${(err as Error).message.slice(0, 160)}`;
        annotations.push({
          line: c.line,
          indent: getIndent(body, c.line),
          callout: renderVerifyCallout('unverified', reason),
        });
        flagged.push({ text: c.text, verdict: 'unverified', reason, citedSources: c.citedSources });
        result.unsupported += 1;
        result.claimsChecked += 1;
      }
      continue;
    }

    const verdictByIdx = new Map<number, ClaimVerdicts['verdicts'][number]>();
    for (const v of verdicts.verdicts) verdictByIdx.set(v.claimIndex, v);

    for (let local = 0; local < subset.length; local++) {
      const c = subset[local];
      const v = verdictByIdx.get(local) ?? verdictByIdx.get(indices[local]);
      const kind: VerdictKind = v ? verdictToKind(v.verdict) : 'unverified';
      const reason = v?.reason ?? 'No verdict returned by model.';
      annotations.push({
        line: c.line,
        indent: getIndent(body, c.line),
        callout: renderVerifyCallout(kind, reason),
      });
      if (kind === 'verified') {
        result.supported += 1;
      } else if (kind === 'partial') {
        result.partial += 1;
        flagged.push({ text: c.text, verdict: kind, reason, citedSources: c.citedSources });
      } else {
        result.unsupported += 1;
        flagged.push({ text: c.text, verdict: kind, reason, citedSources: c.citedSources });
      }
      result.claimsChecked += 1;
    }
  }

  if (annotate && annotations.length) {
    const newBody = annotateBody(body, annotations);
    const out = rewriteWithFrontmatter(parsed.data, newBody);
    writeFileSync(conceptAbsPath, out, 'utf-8');
    result.annotated = true;
  }

  result.reportPath = writeReport(vaultPath, conceptBasename, conceptTitle, result, flagged);
  return result;
}

function buildVerifyPrompt(conceptTitle: string, claims: ExtractedClaim[], sourceTexts: string): string {
  const numbered = claims.map((c, i) => `[${i}] ${c.text}`).join('\n');
  return [
    `CONCEPT: ${conceptTitle}`,
    ``,
    `CLAIMS (indexed):`,
    numbered,
    ``,
    `CITED SOURCES:`,
    sourceTexts,
    ``,
    `TASK: For each claim index, return a verdict: supported | partial | unsupported, with a one-line reason. Optionally quote the best supporting sentence from the source.`,
  ].join('\n');
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[...source truncated...]`;
}

function getIndent(body: string, line: number): string {
  const l = body.split(/\r?\n/)[line] ?? '';
  const m = l.match(/^(\s*)/);
  return m?.[1] ?? '';
}

function rewriteWithFrontmatter(data: Record<string, unknown>, body: string): string {
  const hasData = data && Object.keys(data).length > 0;
  if (!hasData) return body.endsWith('\n') ? body : `${body}\n`;
  const trimmedBody = body.replace(/^\n+/, '');
  return `${yamlFrontmatter(data)}\n\n${trimmedBody}${trimmedBody.endsWith('\n') ? '' : '\n'}`;
}

function writeReport(
  vaultPath: string,
  conceptBasename: string,
  conceptTitle: string,
  result: OneConceptResult,
  flagged: Array<{ text: string; verdict: VerdictKind; reason: string; citedSources: string[] }>,
): string {
  const dir = outputsDir(vaultPath, 'verify');
  mkdirSync(dir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const slug = slugify(conceptBasename, 80);
  const filename = `${date}-${slug}.md`;
  const abs = join(dir, filename);

  const total = result.claimsChecked;
  const fm = yamlFrontmatter({
    title: `Verify Report — ${conceptTitle}`,
    type: 'verify-report',
    concept: `[[${conceptBasename}]]`,
    scanned_at: new Date().toISOString(),
    score: `${result.supported}/${total}`,
    tags: ['output', 'verify'],
  });

  const flaggedBlocks = flagged.length
    ? flagged.map(f => {
        const cites = f.citedSources.length ? f.citedSources.map(s => `[[${s}]]`).join(', ') : '(none)';
        return [
          `### Claim: "${f.text.replace(/"/g, '\\"')}"`,
          `- Verdict: ${f.verdict}`,
          `- Cited sources: ${cites}`,
          `- Reason: ${f.reason}`,
          `- Suggested action: ${suggestAction(f.verdict)}`,
        ].join('\n');
      }).join('\n\n')
    : '_None — all claims supported._';

  const body = [
    `# Verify Report — ${conceptTitle}`,
    ``,
    `## Summary`,
    `- Claims checked: ${total}`,
    `- Supported: ${result.supported}`,
    `- Partial: ${result.partial}`,
    `- Unsupported: ${result.unsupported}`,
    `- Missing source: ${result.missingSource}`,
    ``,
    `## Flagged claims`,
    flaggedBlocks,
    ``,
    `## Next actions`,
    nextActions(result),
    ``,
  ].join('\n');

  writeFileSync(abs, `${fm}\n\n${body}`, 'utf-8');
  return abs;
}

function suggestAction(kind: VerdictKind): string {
  switch (kind) {
    case 'unverified': return 'remove, rewrite, or add a corroborating source';
    case 'partial': return 'tighten claim wording or add a supporting source';
    case 'missing-source': return 'add a [[source]] citation or drop the claim';
    case 'verified': return 'no action';
  }
}

function nextActions(result: OneConceptResult): string {
  const actions: string[] = [];
  if (result.unsupported > 0) actions.push(`- Review ${result.unsupported} unsupported claim(s) — hallucination risk.`);
  if (result.partial > 0) actions.push(`- Tighten ${result.partial} partially-supported claim(s).`);
  if (result.missingSource > 0) actions.push(`- Add citations to ${result.missingSource} uncited claim(s).`);
  if (actions.length === 0) actions.push('- No action needed.');
  return actions.join('\n');
}
