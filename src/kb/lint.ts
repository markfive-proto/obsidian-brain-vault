import { z } from 'zod';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  statSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import matter from 'gray-matter';

import { compiledDir, rawDir, outputsDir } from './paths.js';
import { resolveLLMConfig, llmObject, type LLMConfig } from './llm.js';
import { yamlFrontmatter } from './ingest.js';
import { extractWikilinks } from '../utils/markdown.js';

export type LintSeverity = 'error' | 'warn' | 'info';

export interface LintFinding {
  severity: LintSeverity;
  kind: string;
  path: string;
  line?: number;
  message: string;
  suggestion?: string;
}

export interface LintOptions {
  fix?: boolean;
  suggest?: boolean;
  staleDays?: number;
  config?: LLMConfig;
  onProgress?: (msg: string) => void;
}

export interface LintReport {
  scannedFiles: number;
  errors: number;
  warnings: number;
  infos: number;
  findings: LintFinding[];
  fixesApplied: Array<{ path: string; description: string }>;
  reportPath: string;
}

// ---------- Pure helpers ----------

/**
 * Normalise a concept title for duplicate-detection. Lowercases, strips
 * non-alphanumerics, and collapses common plural suffixes (-s, -es, -ies).
 */
export function normaliseTitleForDupDetection(title: string): string {
  let t = title.toLowerCase().trim();
  // strip file extension
  t = t.replace(/\.md$/, '');
  // strip anything except letters, digits, and a single separator
  t = t.replace(/[^a-z0-9]+/g, '');
  if (t.length <= 3) return t; // too short to safely de-pluralise
  if (t.endsWith('ies') && t.length > 4) {
    t = t.slice(0, -3) + 'y';
  } else if (t.endsWith('es') && t.length > 4 && !/[aeiou]es$/.test(t)) {
    t = t.slice(0, -2);
  } else if (t.endsWith('s') && !t.endsWith('ss') && t.length > 3) {
    t = t.slice(0, -1);
  }
  return t;
}

/**
 * Group titles by their normalised form. Returns groups with 2+ variants.
 * Canonical is chosen as the longest variant (typically the plural) to bias
 * toward the more-general form; callers may override.
 */
export function detectDuplicateConcepts(
  titles: string[],
): Array<{ canonical: string; variants: string[] }> {
  const buckets = new Map<string, string[]>();
  for (const t of titles) {
    const norm = normaliseTitleForDupDetection(t);
    if (!norm) continue;
    const arr = buckets.get(norm) ?? [];
    arr.push(t);
    buckets.set(norm, arr);
  }
  const groups: Array<{ canonical: string; variants: string[] }> = [];
  for (const variants of buckets.values()) {
    const unique = Array.from(new Set(variants));
    if (unique.length < 2) continue;
    const canonical = unique.slice().sort((a, b) => b.length - a.length)[0];
    groups.push({ canonical, variants: unique.sort() });
  }
  return groups;
}

function tagKey(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Flag near-duplicate tags. Tags are considered near-duplicates when their
 * alphanumeric-only, lowercased form matches (e.g. `mlops` / `ml-ops` /
 * `ml_ops`). The canonical form is the most-frequent variant; ties broken
 * alphabetically.
 */
export function detectNearDuplicateTags(
  tagCounts: Record<string, number>,
): Array<{ canonical: string; variants: string[] }> {
  const buckets = new Map<string, string[]>();
  for (const tag of Object.keys(tagCounts)) {
    const k = tagKey(tag);
    if (!k) continue;
    const arr = buckets.get(k) ?? [];
    arr.push(tag);
    buckets.set(k, arr);
  }
  const groups: Array<{ canonical: string; variants: string[] }> = [];
  for (const variants of buckets.values()) {
    const unique = Array.from(new Set(variants));
    if (unique.length < 2) continue;
    const canonical = unique.slice().sort((a, b) => {
      const ca = tagCounts[a] ?? 0;
      const cb = tagCounts[b] ?? 0;
      if (cb !== ca) return cb - ca;
      return a.localeCompare(b);
    })[0];
    groups.push({ canonical, variants: unique.sort() });
  }
  return groups;
}

/**
 * A page is stale if it has a last_updated older than staleDays AND fewer
 * than 2 sources. Missing last_updated is NOT stale on its own — it's caught
 * by the missing-frontmatter check.
 */
export function isStale(
  lastUpdated: string | undefined,
  sourcesCount: number,
  staleDays: number,
  now: Date = new Date(),
): boolean {
  if (!lastUpdated) return false;
  const ts = Date.parse(lastUpdated);
  if (Number.isNaN(ts)) return false;
  const ageDays = (now.getTime() - ts) / (1000 * 60 * 60 * 24);
  return ageDays > staleDays && sourcesCount < 2;
}

// ---------- Filesystem walking ----------

interface VaultFile {
  abs: string;
  rel: string; // vault-relative
  area: 'compiled' | 'raw' | 'other';
  sub: string; // first subdir under area, e.g. 'concepts'
  content: string;
  data: Record<string, unknown>;
  body: string;
  mtimeMs: number;
}

function walk(root: string, out: string[] = []): string[] {
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const p = join(root, entry.name);
    if (entry.isDirectory()) {
      walk(p, out);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(p);
    }
  }
  return out;
}

function readVaultFile(vaultPath: string, abs: string): VaultFile {
  const content = readFileSync(abs, 'utf-8');
  const parsed = matter(content);
  const rel = relative(vaultPath, abs).split('\\').join('/');
  const parts = rel.split('/');
  const areaRaw = parts[0];
  const area: 'compiled' | 'raw' | 'other' =
    areaRaw === 'compiled' ? 'compiled' : areaRaw === 'raw' ? 'raw' : 'other';
  const sub = parts[1] ?? '';
  const st = statSync(abs);
  return {
    abs,
    rel,
    area,
    sub,
    content,
    data: (parsed.data as Record<string, unknown>) ?? {},
    body: parsed.content,
    mtimeMs: st.mtimeMs,
  };
}

function fileBasename(rel: string): string {
  const parts = rel.split('/');
  return (parts[parts.length - 1] ?? '').replace(/\.md$/, '');
}

// ---------- Main lint ----------

const INBOX_PATTERNS = ['inbox', 'scratch', 'drafts'];

function isInbox(rel: string): boolean {
  const lower = rel.toLowerCase();
  return INBOX_PATTERNS.some(p => lower.includes(`/${p}/`) || lower.startsWith(`${p}/`));
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(x => String(x));
  if (typeof v === 'string') return [v];
  return [];
}

export async function lintKb(vaultPath: string, opts: LintOptions): Promise<LintReport> {
  const progress = opts.onProgress ?? (() => {});
  const staleDays = opts.staleDays ?? 90;
  const findings: LintFinding[] = [];
  const fixesApplied: Array<{ path: string; description: string }> = [];

  const compiledRoot = compiledDir(vaultPath);
  const rawRoot = rawDir(vaultPath, '').replace(/\/$/, '');
  const allAbs = [...walk(compiledRoot), ...walk(rawRoot)];
  const files: VaultFile[] = [];
  for (const abs of allAbs) {
    try {
      files.push(readVaultFile(vaultPath, abs));
    } catch (err) {
      findings.push({
        severity: 'warn',
        kind: 'parse-error',
        path: relative(vaultPath, abs).split('\\').join('/'),
        message: `Failed to parse: ${(err as Error).message}`,
      });
    }
  }
  progress(`Scanned ${files.length} files`);

  const byBasename = new Map<string, VaultFile[]>();
  for (const f of files) {
    const key = fileBasename(f.rel).toLowerCase();
    const arr = byBasename.get(key) ?? [];
    arr.push(f);
    byBasename.set(key, arr);
  }

  // 1. Broken wikilinks + outgoing index + dangling tracking
  const outgoing = new Map<string, Set<string>>(); // file.rel -> set of target basenames (lower)
  const incoming = new Map<string, Set<string>>(); // file.rel -> set of source rels
  const danglingRefs = new Map<string, Set<string>>(); // missing-target (lower) -> set of source rels

  for (const f of files) {
    const links = extractWikilinks(f.content);
    const out = new Set<string>();
    const bodyLines = f.content.split('\n');
    for (const link of links) {
      if (!link.target.trim()) continue;
      const targetKey = link.target.toLowerCase().replace(/\.md$/, '');
      out.add(targetKey);
      const hit = byBasename.get(targetKey);
      if (!hit || hit.length === 0) {
        // dangling/broken
        const line = bodyLines.findIndex(l => l.includes(`[[${link.target}`));
        findings.push({
          severity: 'error',
          kind: 'broken-link',
          path: f.rel,
          line: line >= 0 ? line + 1 : undefined,
          message: `Wikilink [[${link.target}]] does not resolve to any vault file.`,
        });
        const set = danglingRefs.get(targetKey) ?? new Set<string>();
        set.add(f.rel);
        danglingRefs.set(targetKey, set);
      } else {
        for (const h of hit) {
          const inc = incoming.get(h.rel) ?? new Set<string>();
          inc.add(f.rel);
          incoming.set(h.rel, inc);
        }
      }
    }
    outgoing.set(f.rel, out);
  }

  // 2. Orphan compiled notes
  for (const f of files) {
    if (f.area !== 'compiled') continue;
    if (isInbox(f.rel)) continue;
    const inc = incoming.get(f.rel);
    const out = outgoing.get(f.rel);
    const incCount = inc ? inc.size : 0;
    const outCount = out ? out.size : 0;
    if (incCount === 0 && outCount === 0) {
      findings.push({
        severity: 'warn',
        kind: 'orphan',
        path: f.rel,
        message: 'Compiled note has no incoming or outgoing wikilinks.',
        suggestion: 'Link it from a hub/index note or remove it.',
      });
    }
  }

  // 3. Missing frontmatter
  for (const f of files) {
    const missing: string[] = [];
    if (f.area === 'compiled') {
      for (const k of ['title', 'type', 'tags', 'last_updated']) {
        const v = f.data[k];
        if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
          missing.push(k);
        }
      }
    } else if (f.area === 'raw') {
      for (const k of ['source_type', 'tags']) {
        const v = f.data[k];
        if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
          missing.push(k);
        }
      }
    } else {
      continue;
    }
    if (missing.length > 0) {
      findings.push({
        severity: 'warn',
        kind: 'missing-frontmatter',
        path: f.rel,
        message: `Missing frontmatter keys: ${missing.join(', ')}.`,
      });
    }
  }

  // 4. Duplicate concepts (compiled/concepts only)
  const conceptFiles = files.filter(f => f.area === 'compiled' && f.sub === 'concepts');
  const conceptTitles = conceptFiles.map(f => fileBasename(f.rel));
  const dupGroups = detectDuplicateConcepts(conceptTitles);
  for (const g of dupGroups) {
    findings.push({
      severity: 'warn',
      kind: 'dup-concept',
      path: 'compiled/concepts/',
      message: `Possible duplicate concepts: ${g.variants.map(v => `[[${v}]]`).join(', ')}.`,
      suggestion: `Canonical: [[${g.canonical}]]. Merge manually.`,
    });
  }

  // 5. Tag drift
  const tagCounts: Record<string, number> = {};
  for (const f of files) {
    for (const t of asStringArray(f.data.tags)) {
      tagCounts[t] = (tagCounts[t] ?? 0) + 1;
    }
  }
  for (const [tag, count] of Object.entries(tagCounts)) {
    if (count <= 2) {
      findings.push({
        severity: 'info',
        kind: 'tag-drift',
        path: '(vault)',
        message: `Tag "${tag}" used only ${count} time(s).`,
        suggestion: 'Fold into a more common tag or retire.',
      });
    }
  }
  const nearDupTags = detectNearDuplicateTags(tagCounts);
  for (const g of nearDupTags) {
    findings.push({
      severity: 'info',
      kind: 'tag-drift',
      path: '(vault)',
      message: `Near-duplicate tags: ${g.variants.join(', ')}.`,
      suggestion: `Canonicalise to "${g.canonical}".`,
    });
  }

  // 6. Stale pages
  for (const f of conceptFiles) {
    const lu = typeof f.data.last_updated === 'string' ? f.data.last_updated : undefined;
    const srcRaw = f.data.sources_count ?? f.data.sourcesCount;
    const srcCount =
      typeof srcRaw === 'number'
        ? srcRaw
        : Array.isArray(f.data.sources)
        ? f.data.sources.length
        : 0;
    if (isStale(lu, srcCount, staleDays)) {
      findings.push({
        severity: 'warn',
        kind: 'stale',
        path: f.rel,
        message: `last_updated ${lu} is older than ${staleDays} days and sources_count=${srcCount}.`,
        suggestion: 'Revisit and add a fresh source.',
      });
    }
  }

  // 7. Dangling wikilinks referenced from 2+ pages
  for (const [target, sources] of danglingRefs.entries()) {
    if (sources.size >= 2) {
      findings.push({
        severity: 'info',
        kind: 'dangling-wikilink',
        path: '(vault)',
        message: `[[${target}]] referenced by ${sources.size} pages but has no note.`,
        suggestion: `Good candidate for a new compiled/concepts/${target}.md.`,
      });
    }
  }

  // 8. Next-to-write via LLM
  if (opts.suggest) {
    try {
      progress('Calling LLM for next-to-write suggestions...');
      const candidates = Array.from(danglingRefs.entries())
        .map(([target, sources]) => ({ target, refs: sources.size }))
        .sort((a, b) => b.refs - a.refs)
        .slice(0, 30);
      if (candidates.length > 0) {
        const config = resolveLLMConfig(opts.config);
        const schema = z.object({
          suggestions: z
            .array(
              z.object({
                target: z.string(),
                pitch: z.string(),
                priority: z.number().int().min(1).max(10),
              }),
            )
            .max(10),
        });
        const prompt =
          `You are curating an LLM/ML knowledge wiki. The following wikilink targets are ` +
          `referenced from multiple notes but have no dedicated page yet. Rank the top ` +
          `suggestions by value-if-written and give a one-sentence pitch each.\n\n` +
          `Candidates (target, reference count):\n` +
          candidates.map(c => `- ${c.target} (${c.refs})`).join('\n');
        const out = await llmObject(prompt, schema, { config });
        for (const s of out.suggestions) {
          findings.push({
            severity: 'info',
            kind: 'suggest-article',
            path: `compiled/concepts/${s.target}.md`,
            message: `Next-to-write (priority ${s.priority}): ${s.pitch}`,
            suggestion: `Create [[${s.target}]].`,
          });
        }
      }
    } catch (err) {
      findings.push({
        severity: 'warn',
        kind: 'suggest-article',
        path: '(llm)',
        message: `Next-to-write suggestion failed: ${(err as Error).message}`,
      });
    }
  }

  // ---------- --fix mode ----------
  if (opts.fix) {
    // Canonical tag map
    const canonicalByVariant = new Map<string, string>();
    for (const g of nearDupTags) {
      for (const v of g.variants) {
        if (v !== g.canonical) canonicalByVariant.set(v, g.canonical);
      }
    }

    for (const f of files) {
      let changed = false;
      const descs: string[] = [];
      const data: Record<string, unknown> = { ...f.data };

      // last_updated from mtime when missing
      if (f.area === 'compiled') {
        const lu = data.last_updated;
        if (lu === undefined || lu === null || (typeof lu === 'string' && lu.trim() === '')) {
          data.last_updated = new Date(f.mtimeMs).toISOString().slice(0, 10);
          changed = true;
          descs.push('added last_updated from mtime');
        }
      }

      // canonicalise near-duplicate tags
      const tags = asStringArray(data.tags);
      if (tags.length > 0 && canonicalByVariant.size > 0) {
        const next: string[] = [];
        const seen = new Set<string>();
        let mutated = false;
        for (const t of tags) {
          const canon = canonicalByVariant.get(t) ?? t;
          if (canon !== t) mutated = true;
          if (!seen.has(canon)) {
            seen.add(canon);
            next.push(canon);
          }
        }
        if (mutated) {
          data.tags = next;
          changed = true;
          descs.push('canonicalised near-duplicate tags');
        }
      }

      // strip trailing whitespace on body
      const strippedBody = f.body
        .split('\n')
        .map(l => l.replace(/[ \t]+$/g, ''))
        .join('\n');
      const bodyChanged = strippedBody !== f.body;
      if (bodyChanged) {
        changed = true;
        descs.push('stripped trailing whitespace');
      }

      if (changed) {
        const hadFrontmatter = /^---\s*\n/.test(f.content);
        const newContent = hadFrontmatter
          ? `${yamlFrontmatter(data)}\n${strippedBody.replace(/^\n+/, '\n')}`
          : strippedBody;
        writeFileSync(f.abs, newContent, 'utf-8');
        for (const d of descs) {
          fixesApplied.push({ path: f.rel, description: d });
        }
      }
    }
  }

  // ---------- Report ----------
  const errors = findings.filter(f => f.severity === 'error').length;
  const warnings = findings.filter(f => f.severity === 'warn').length;
  const infos = findings.filter(f => f.severity === 'info').length;

  const date = new Date().toISOString().slice(0, 10);
  const lintOutDir = outputsDir(vaultPath, 'lint');
  mkdirSync(lintOutDir, { recursive: true });
  const reportAbs = join(lintOutDir, `${date}-full.md`);
  const reportRel = relative(vaultPath, reportAbs).split('\\').join('/');

  const md = renderReport({
    date,
    scanned: files.length,
    errors,
    warnings,
    infos,
    findings,
    fixesApplied,
    suggested: !!opts.suggest,
  });
  writeFileSync(reportAbs, md, 'utf-8');

  return {
    scannedFiles: files.length,
    errors,
    warnings,
    infos,
    findings,
    fixesApplied,
    reportPath: reportRel,
  };
}

function groupBy<T>(arr: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const t of arr) {
    const k = key(t);
    const a = m.get(k) ?? [];
    a.push(t);
    m.set(k, a);
  }
  return m;
}

function renderSection(title: string, findings: LintFinding[]): string {
  if (findings.length === 0) return '';
  const lines: string[] = [`### ${title} (${findings.length})`, ''];
  for (const f of findings) {
    const loc = f.line ? `${f.path}:${f.line}` : f.path;
    const tail = f.suggestion ? ` — ${f.suggestion}` : '';
    lines.push(`- \`${loc}\` — ${f.message}${tail}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderReport(args: {
  date: string;
  scanned: number;
  errors: number;
  warnings: number;
  infos: number;
  findings: LintFinding[];
  fixesApplied: Array<{ path: string; description: string }>;
  suggested: boolean;
}): string {
  const { date, scanned, errors, warnings, infos, findings, fixesApplied } = args;
  const byKind = groupBy(findings, f => f.kind);
  const get = (k: string) => byKind.get(k) ?? [];

  const frontmatter = yamlFrontmatter({
    title: `Lint Report — ${date}`,
    type: 'lint-report',
    run: 'full',
    scanned,
    errors,
    warnings,
    infos,
    tags: ['output', 'lint'],
  });

  const parts: string[] = [];
  parts.push(frontmatter);
  parts.push('');
  parts.push(`# Lint Report — ${date}`);
  parts.push('');
  parts.push('## Summary');
  parts.push(`- Scanned ${scanned} files.`);
  parts.push(`- Errors: ${errors}`);
  parts.push(`- Warnings: ${warnings}`);
  parts.push(`- Info: ${infos}`);
  parts.push(`- Fixes applied: ${fixesApplied.length}`);
  parts.push('');

  if (errors > 0) {
    parts.push('## Errors');
    parts.push('');
    parts.push(renderSection('Broken wikilinks', get('broken-link')));
    const otherErrors = findings.filter(
      f => f.severity === 'error' && f.kind !== 'broken-link',
    );
    if (otherErrors.length > 0) {
      parts.push(renderSection('Other errors', otherErrors));
    }
  }

  if (warnings > 0) {
    parts.push('## Warnings');
    parts.push('');
    parts.push(renderSection('Missing frontmatter', get('missing-frontmatter')));
    parts.push(renderSection('Orphan compiled notes', get('orphan')));
    parts.push(renderSection('Duplicate concepts', get('dup-concept')));
    parts.push(renderSection('Stale pages', get('stale')));
    const otherWarns = findings.filter(
      f =>
        f.severity === 'warn' &&
        !['missing-frontmatter', 'orphan', 'dup-concept', 'stale'].includes(f.kind),
    );
    if (otherWarns.length > 0) {
      parts.push(renderSection('Other warnings', otherWarns));
    }
  }

  if (infos > 0) {
    parts.push('## Info / suggestions');
    parts.push('');
    parts.push(renderSection('Tag drift', get('tag-drift')));
    parts.push(renderSection('Dangling wikilinks', get('dangling-wikilink')));
    const suggestions = get('suggest-article').filter(f => f.severity === 'info');
    if (suggestions.length > 0) {
      parts.push('## Next-to-write');
      parts.push('');
      parts.push(renderSection(`Top ${suggestions.length}`, suggestions));
    }
  }

  if (fixesApplied.length > 0) {
    parts.push('## Fixes applied');
    parts.push('');
    for (const f of fixesApplied) {
      parts.push(`- \`${f.path}\`: ${f.description}`);
    }
    parts.push('');
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}
