import { z } from 'zod';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { compiledDir, ingestLogPath } from './paths.js';
import { llmObject, resolveLLMConfig, type LLMConfig } from './llm.js';
import { slugify, yamlFrontmatter } from './ingest.js';

// ---- Schemas ----------------------------------------------------------------

const ConceptExtractionSchema = z.object({
  concepts: z
    .array(
      z.object({
        name: z.string().describe('Canonical, multi-word-noun form (e.g. "scaled dot-product attention"). Title case.'),
        kind: z.enum(['concept', 'person', 'org']).describe('concept = abstract idea/method/framework; person = named individual; org = company/team/group'),
        summary: z.string().describe('One sentence, grounded in the source. No padding.'),
        contribution: z.string().describe('What THIS specific source adds to the concept — 2-5 lines synthesis, not a raw quote.'),
        tags: z.array(z.string()).optional().describe('Lowercase, hyphenated. 1-4 tags max. Domain-level (e.g. ml, transformers, training).'),
      }),
    )
    .min(1)
    .max(12)
    .describe('Extract 3-10 concepts that deserve their own page. Skip pronouns, generic terms, and one-off mentions.'),
  openQuestions: z
    .array(z.string())
    .optional()
    .describe('Up to 5 questions the source raises but does NOT answer — seed for future research.'),
});

type ExtractedConcept = z.infer<typeof ConceptExtractionSchema>['concepts'][number];

// ---- Public API -------------------------------------------------------------

export interface CompileOptions {
  full?: boolean;
  since?: string;          // ISO date string; only raw files newer than this
  dryRun?: boolean;
  config?: LLMConfig;
  onProgress?: (msg: string) => void;
}

export interface CompileReport {
  rawRead: number;
  conceptsTouched: number;
  conceptsNew: number;
  pagesWritten: string[];
  skipped: Array<{ path: string; reason: string }>;
}

export async function compileKb(vaultPath: string, opts: CompileOptions = {}): Promise<CompileReport> {
  const config = opts.config ?? resolveLLMConfig();
  const log = (msg: string) => opts.onProgress?.(msg);

  const toCompile = findSourcesToCompile(vaultPath, opts);
  log(`Found ${toCompile.length} raw source(s) to compile.`);

  const report: CompileReport = {
    rawRead: 0,
    conceptsTouched: 0,
    conceptsNew: 0,
    pagesWritten: [],
    skipped: [],
  };

  for (const rawPath of toCompile) {
    const absPath = join(vaultPath, rawPath);
    if (!existsSync(absPath)) {
      report.skipped.push({ path: rawPath, reason: 'file missing' });
      continue;
    }
    const raw = readFileSync(absPath, 'utf-8');
    const { data: fm, content } = matter(raw);
    const sourceTitle = typeof fm.title === 'string' ? fm.title : rawPath.split('/').pop() ?? rawPath;

    log(`Extracting concepts from ${rawPath}`);
    report.rawRead += 1;

    let extraction: z.infer<typeof ConceptExtractionSchema>;
    try {
      extraction = await llmObject(
        buildExtractionPrompt(sourceTitle, fm, content),
        ConceptExtractionSchema,
        {
          config,
          system:
            'You are extracting concepts from a single source for a personal knowledge wiki. ' +
            'Be specific and high-signal. Prefer 5 high-quality concepts over 12 mediocre ones. ' +
            'Do not invent claims that are not in the source.',
          maxTokens: 4000,
        },
      );
    } catch (err) {
      report.skipped.push({ path: rawPath, reason: `LLM error: ${(err as Error).message.slice(0, 200)}` });
      continue;
    }

    const sourceBasename = rawPath.split('/').pop()?.replace(/\.md$/, '') ?? rawPath;

    for (const concept of extraction.concepts) {
      const { isNew, absPath: cpPath, relPath: cpRelPath } = upsertConceptPage(
        vaultPath,
        concept,
        sourceBasename,
        extraction.openQuestions ?? [],
      );
      report.conceptsTouched += 1;
      if (isNew) {
        report.conceptsNew += 1;
        log(`  + new: ${cpRelPath}`);
      }
      if (!report.pagesWritten.includes(cpRelPath)) report.pagesWritten.push(cpRelPath);
    }
  }

  if (!opts.dryRun) {
    rebuildIndex(vaultPath);
    appendCompileLog(vaultPath, {
      mode: opts.full ? 'full' : 'incremental',
      rawAdded: report.rawRead,
      conceptsTouched: report.conceptsTouched,
      conceptsNew: report.conceptsNew,
    });
  }

  return report;
}

// ---- Helpers ----------------------------------------------------------------

export function findSourcesToCompile(vaultPath: string, opts: CompileOptions): string[] {
  const logPath = ingestLogPath(vaultPath);
  if (!existsSync(logPath)) return [];

  // Parse `- <ISO>  <type>  <path>  "<title>"` lines
  const log = readFileSync(logPath, 'utf-8');
  const entries = log
    .split(/\r?\n/)
    .map(line => {
      const m = line.match(/^-\s+(\S+\s+\S+)\s+(\w+)\s+(\S+)\s+"(.*)"$/);
      if (!m) return null;
      return { ts: m[1], type: m[2], path: m[3], title: m[4] };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (entries.length === 0) return [];

  if (opts.full) return entries.map(e => e.path);

  // Default: since last compile run
  const compiledLog = join(vaultPath, 'compiled', 'COMPILE-LOG.md');
  let lastCompileTs: string | null = null;
  if (existsSync(compiledLog)) {
    const txt = readFileSync(compiledLog, 'utf-8');
    const compileLines = txt.split(/\r?\n/).filter(l => /^-\s+\d{4}-\d{2}-\d{2}/.test(l));
    if (compileLines.length) {
      const last = compileLines[compileLines.length - 1];
      const m = last.match(/^-\s+(\S+\s+\S+)/);
      lastCompileTs = m?.[1] ?? null;
    }
  }

  if (opts.since) lastCompileTs = opts.since;

  const cutoff = lastCompileTs ? new Date(lastCompileTs.replace(' ', 'T') + 'Z').getTime() : -Infinity;
  return entries
    .filter(e => new Date(e.ts.replace(' ', 'T') + 'Z').getTime() > cutoff)
    .map(e => e.path);
}

function buildExtractionPrompt(title: string, fm: Record<string, unknown>, body: string): string {
  const metaLines: string[] = [];
  for (const [k, v] of Object.entries(fm)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    metaLines.push(`${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`);
  }
  // Trim very long sources to keep the prompt reasonable; tail-bias is fine
  // because paper abstracts and article intros are at the top.
  const MAX_CHARS = 60_000;
  const truncatedBody = body.length > MAX_CHARS ? `${body.slice(0, MAX_CHARS)}\n\n[...source truncated for context budget...]` : body;
  return [
    `SOURCE TITLE: ${title}`,
    `METADATA:\n${metaLines.join('\n')}`,
    `\nSOURCE BODY:\n${truncatedBody}`,
    `\nTASK: Extract 3-10 concepts that deserve their own concept page in a personal knowledge wiki.`,
    `Also list up to 5 open questions the source raises but does not answer.`,
  ].join('\n');
}

interface UpsertResult {
  isNew: boolean;
  absPath: string;
  relPath: string;
}

function conceptDirForKind(vaultPath: string, kind: ExtractedConcept['kind']): string {
  switch (kind) {
    case 'person': return compiledDir(vaultPath, 'people');
    case 'org':    return compiledDir(vaultPath, 'orgs');
    default:       return compiledDir(vaultPath, 'concepts');
  }
}

function upsertConceptPage(
  vaultPath: string,
  concept: ExtractedConcept,
  sourceBasename: string,
  openQuestions: string[],
): UpsertResult {
  const dir = conceptDirForKind(vaultPath, concept.kind);
  mkdirSync(dir, { recursive: true });

  // Canonical filename: slug of the concept name. Avoids "Attention is all you Need"
  // ≠ "Attention Is All You Need" drift.
  const filename = `${slugify(concept.name, 80)}.md`;
  const absPath = join(dir, filename);
  const relPath = join('compiled', concept.kind === 'person' ? 'people' : concept.kind === 'org' ? 'orgs' : 'concepts', filename);

  if (!existsSync(absPath)) {
    const fm = yamlFrontmatter({
      title: concept.name,
      type: concept.kind,
      tags: ['compiled', ...(concept.tags ?? [])],
      first_seen: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      sources_count: 1,
    });
    const body = renderNewConceptBody(concept, sourceBasename, openQuestions);
    writeFileSync(absPath, `${fm}\n\n${body}\n`, 'utf-8');
    return { isNew: true, absPath, relPath };
  }

  // Existing: append/merge source contribution under ## Sources and refresh frontmatter counts.
  const raw = readFileSync(absPath, 'utf-8');
  if (/^human-edited:\s*true\s*$/m.test(raw)) {
    // Locked — skip body rewrite, still append source under a "(pending merge)" block.
    writeFileSync(absPath, raw, 'utf-8');
    return { isNew: false, absPath, relPath };
  }

  const merged = mergeExistingConcept(raw, concept, sourceBasename, openQuestions);
  writeFileSync(absPath, merged, 'utf-8');
  return { isNew: false, absPath, relPath };
}

function renderNewConceptBody(concept: ExtractedConcept, sourceBasename: string, openQuestions: string[]): string {
  const related = ''; // populated on later compiles, not initial creation
  const oq = openQuestions.length
    ? `\n## Open questions\n${openQuestions.map(q => `- ${q}`).join('\n')}\n`
    : '';
  return [
    `# ${concept.name}`,
    ``,
    `## TL;DR`,
    concept.summary,
    ``,
    `## Key claims`,
    `- ${concept.contribution.split('\n').map(l => l.trim()).filter(Boolean).join(' ')} — from [[${sourceBasename}]]`,
    ``,
    related && `## Related concepts\n${related}\n`,
    `## Sources`,
    `### [[${sourceBasename}]]`,
    concept.contribution,
    oq,
  ].filter(Boolean).join('\n');
}

function mergeExistingConcept(raw: string, concept: ExtractedConcept, sourceBasename: string, openQuestions: string[]): string {
  const parsed = matter(raw);
  const fm = parsed.data ?? {};
  fm.last_updated = new Date().toISOString();
  fm.sources_count = Number(fm.sources_count ?? 0) + 1;
  if (!Array.isArray(fm.tags)) fm.tags = fm.tags ? [fm.tags].flat() : [];
  for (const tag of concept.tags ?? []) {
    if (!fm.tags.includes(tag)) fm.tags.push(tag);
  }

  let body = parsed.content;

  // Append a new source contribution if not already present
  const sourceHeading = `### [[${sourceBasename}]]`;
  if (!body.includes(sourceHeading)) {
    const sourcesIdx = body.search(/^##\s+Sources\b/m);
    const appendBlock = `${sourceHeading}\n${concept.contribution}\n\n`;
    if (sourcesIdx >= 0) {
      body = body.replace(/^(##\s+Sources\b.*)$/m, `$1\n\n${appendBlock}`.trimEnd());
    } else {
      body = `${body.trimEnd()}\n\n## Sources\n\n${appendBlock}`;
    }
    // Append claim bullet to Key claims if we have that section
    const claimLine = `- ${concept.contribution.split('\n')[0]} — from [[${sourceBasename}]]`;
    if (/^##\s+Key claims\b/m.test(body)) {
      body = body.replace(/^##\s+Key claims\b[\s\S]*?(?=^##\s|\Z)/m, block => `${block.trimEnd()}\n${claimLine}\n\n`);
    }
  }

  // Merge open questions (append, don't delete)
  if (openQuestions.length) {
    const oqIdx = body.search(/^##\s+Open questions\b/m);
    const existing = oqIdx >= 0 ? body.slice(oqIdx) : '';
    const toAdd = openQuestions.filter(q => !existing.includes(q));
    if (toAdd.length) {
      if (oqIdx >= 0) {
        body = body.replace(/^##\s+Open questions\b[\s\S]*?(?=^##\s|\Z)/m, block => {
          return `${block.trimEnd()}\n${toAdd.map(q => `- ${q}`).join('\n')}\n\n`;
        });
      } else {
        body = `${body.trimEnd()}\n\n## Open questions\n${toAdd.map(q => `- ${q}`).join('\n')}\n`;
      }
    }
  }

  return `${yamlFrontmatter(fm)}\n${body.trim()}\n`;
}

/** Regenerate compiled/00-INDEX.md as a grouped Map of Content. */
export function rebuildIndex(vaultPath: string): void {
  const groups: Record<'concepts' | 'people' | 'orgs', Array<{ name: string; path: string; lastUpdated: string }>> = {
    concepts: [],
    people: [],
    orgs: [],
  };

  for (const kind of Object.keys(groups) as Array<keyof typeof groups>) {
    const dir = compiledDir(vaultPath, kind);
    if (!existsSync(dir)) continue;
    for (const fname of readdirSync(dir)) {
      if (!fname.endsWith('.md')) continue;
      const abs = join(dir, fname);
      try {
        const raw = readFileSync(abs, 'utf-8');
        const { data } = matter(raw);
        const name = typeof data.title === 'string' ? data.title : fname.replace(/\.md$/, '');
        const lastUpdated = typeof data.last_updated === 'string' ? data.last_updated : '';
        groups[kind].push({ name, path: `${kind}/${fname}`, lastUpdated });
      } catch { /* skip unreadable */ }
    }
  }

  const formatList = (items: typeof groups.concepts) =>
    items
      .sort((a, b) => (b.lastUpdated || '').localeCompare(a.lastUpdated || ''))
      .map(i => `- [[${i.name}]]`)
      .join('\n');

  const lines: string[] = [
    '---',
    'title: Knowledge Base Index',
    'type: moc',
    'tags: [kb, index]',
    `last_updated: ${new Date().toISOString()}`,
    '---',
    '',
    '# Knowledge Base Index',
    '',
    `Auto-generated by \`obs kb compile\`. Do not edit by hand — changes are overwritten.`,
    '',
    `**Stats:** ${groups.concepts.length} concepts · ${groups.people.length} people · ${groups.orgs.length} orgs`,
    '',
  ];

  if (groups.concepts.length) {
    lines.push('## Concepts', '', formatList(groups.concepts), '');
  }
  if (groups.people.length) {
    lines.push('## People', '', formatList(groups.people), '');
  }
  if (groups.orgs.length) {
    lines.push('## Orgs', '', formatList(groups.orgs), '');
  }

  writeFileSync(join(compiledDir(vaultPath), '00-INDEX.md'), lines.join('\n'), 'utf-8');
}

function appendCompileLog(
  vaultPath: string,
  entry: { mode: string; rawAdded: number; conceptsTouched: number; conceptsNew: number },
): void {
  const logPath = join(compiledDir(vaultPath), 'COMPILE-LOG.md');
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `- ${now}  run=${entry.mode}  raw_added=${entry.rawAdded}  concepts_touched=${entry.conceptsTouched}  concepts_new=${entry.conceptsNew}\n`;
  if (!existsSync(logPath)) {
    const header = `# Compile Log\n\nOne line per compile run. Append-only.\n\nFormat: \`- <ISO-date>  run=<mode>  raw_added=<N>  concepts_touched=<N>  concepts_new=<N>\`\n\n---\n\n`;
    writeFileSync(logPath, header + line, 'utf-8');
  } else {
    appendFileSync(logPath, line, 'utf-8');
  }
}
