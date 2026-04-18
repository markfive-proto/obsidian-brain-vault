import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { outputsDir } from './paths.js';
import { yamlFrontmatter } from './ingest.js';
import { ingestCodebase, type IngestCodebaseResult } from './ingest-codebase.js';
import { compileKb, type CompileReport } from './compile.js';
import { askKb, type AskResult } from './ask.js';
import { resolveLLMConfig, type LLMConfig } from './llm.js';

export interface SnapshotOptions {
  repoPath?: string;
  question?: string;
  config?: LLMConfig;
  onProgress?: (msg: string) => void;
}

export interface SnapshotResult {
  codebase: IngestCodebaseResult;
  compile: CompileReport;
  ask: AskResult;
  snapshotPath: string;
}

const DEFAULT_QUESTION =
  'Give me a one-page snapshot of this project: what it is, recent direction, open questions, key modules.';

export async function snapshotProject(
  vaultPath: string,
  opts: SnapshotOptions = {},
): Promise<SnapshotResult> {
  const repoPath = opts.repoPath ?? '.';
  const question = opts.question ?? DEFAULT_QUESTION;
  const config = opts.config ?? resolveLLMConfig();
  const progress = opts.onProgress ?? (() => {});

  progress('[1/4] ingesting codebase');
  const codebase = await ingestCodebase(vaultPath, repoPath, { onProgress: progress });

  progress('[2/4] compiling knowledge base');
  const compile = await compileKb(vaultPath, { config, onProgress: progress });

  progress('[3/4] asking snapshot question');
  const ask = await askKb(vaultPath, question, { config, includeRaw: true });

  progress('[4/4] writing consolidated snapshot');
  const dateStamp = new Date().toISOString().slice(0, 10);
  const filename = `${dateStamp}-${codebase.repoSlug}.md`;
  const dir = outputsDir(vaultPath, 'snapshots');
  mkdirSync(dir, { recursive: true });
  const absolutePath = join(dir, filename);
  const relativePath = join('outputs', 'snapshots', filename);

  const fm = yamlFrontmatter({
    title: `Snapshot — ${codebase.repoSlug}`,
    source_type: 'snapshot',
    repo_slug: codebase.repoSlug,
    repo_root: codebase.repoRoot,
    generated_at: new Date().toISOString(),
    tags: ['snapshot', 'codebase'],
  });

  const body = [
    `# Snapshot — ${codebase.repoSlug}`,
    '',
    `Generated: ${new Date().toISOString()}`,
    codebase.remote ? `Remote: ${codebase.remote}` : '',
    `Repo root: \`${codebase.repoRoot}\``,
    '',
    `## Question`,
    '',
    question,
    '',
    `## Answer`,
    '',
    ...ask.answer.tldrBullets.map(b => `- ${b}`),
    '',
    ask.answer.detailedAnswer,
    '',
    `## Ingest summary`,
    '',
    `- Files ingested: ${codebase.filesIngested.length}`,
    `- Bytes written: ${codebase.totalBytes}`,
    `- Skipped: ${codebase.skipped.length}`,
    '',
    `### Raw files`,
    '',
    ...codebase.filesIngested.map(p => `- [[${p}]]`),
    '',
    `## Compile report`,
    '',
    `- Raw files read: ${compile.rawRead}`,
    `- Concepts touched: ${compile.conceptsTouched} (new: ${compile.conceptsNew})`,
    `- Pages written: ${compile.pagesWritten.length}`,
    '',
    `## Full answer note`,
    '',
    `See [[${ask.answerPath}]] for the full answer with evidence map.`,
    '',
  ]
    .filter(Boolean)
    .join('\n');

  writeFileSync(absolutePath, `${fm}\n\n${body}\n`, 'utf-8');

  return { codebase, compile, ask, snapshotPath: relativePath };
}
