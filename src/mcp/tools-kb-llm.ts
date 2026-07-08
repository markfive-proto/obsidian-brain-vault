import { z } from 'zod';
import type { ZodRawShape } from 'zod';
import { defineTool, type ToolDef } from './registry.js';
import { ingestArticle } from '../kb/ingest.js';
import { compileKb } from '../kb/compile.js';
import { askKb } from '../kb/ask.js';
import { lintKb } from '../kb/lint.js';

/**
 * The LLM-backed KB pipeline exposed over MCP. These are the tools the
 * bundled MCP prompts (/clip, /compile, /ask, /lint) reference — remote
 * clients (Claude web/mobile) have no shell, so this is their only way to
 * run the pipeline.
 *
 * LLM calls run inside the MCP request; work is bounded per call (compile
 * defaults to 3 sources) and progress is streamed via notifications.
 */

const kbIngest = defineTool({
  name: 'obs_kb_ingest',
  description: 'Ingest a URL as an article into raw/articles/ (fetch → clean markdown → log). Does not touch compiled/.',
  scope: 'write',
  schema: {
    url: z.string().url().describe('HTTP(S) URL to ingest'),
    overwrite: z.boolean().optional().describe('Overwrite if the target raw file already exists (default: false)'),
  },
  handler: async ({ url, overwrite }, ctx) => {
    await ctx.progress(`Fetching ${url}`);
    const result = await ingestArticle(ctx.vault.path, url, { overwrite });
    return {
      path: result.path,
      title: result.title,
      wordCount: result.wordCount,
      duplicate: result.duplicate ?? false,
      next: result.duplicate
        ? 'Already ingested — pass overwrite: true to refresh.'
        : 'Run obs_kb_compile to fold it into the wiki.',
    };
  },
});

const kbCompile = defineTool({
  name: 'obs_kb_compile',
  description: 'Compile new raw/ sources into compiled/ concept pages via LLM. Bounded per call (default limit 3 sources); call again to continue.',
  scope: 'llm',
  schema: {
    full: z.boolean().optional().describe('Recompile all logged raw sources, not just ones newer than the last run'),
    dryRun: z.boolean().optional().describe('Report what would compile without writing'),
    limit: z.number().int().min(1).max(20).optional().describe('Max raw sources to process this call (default: 3)'),
  },
  handler: async ({ full, dryRun, limit }, ctx) => {
    const report = await compileKb(ctx.vault.path, {
      full,
      dryRun,
      limit: limit ?? 3,
      onProgress: msg => { void ctx.progress(msg); },
    });
    return report;
  },
});

const kbAsk = defineTool({
  name: 'obs_kb_ask',
  description: 'Answer a question from the compiled wiki via LLM. Saves a cited answer note to outputs/answers/ and reports gaps the wiki cannot cover.',
  scope: 'llm',
  schema: {
    question: z.string().min(3).describe('The question to answer from the wiki'),
    includeRaw: z.boolean().optional().describe('Also load raw/ sources, not just compiled/ (default: false)'),
    deep: z.boolean().optional().describe('Run a second retrieval round seeded by round-1 gaps (needs the embedding index; default: false)'),
  },
  handler: async ({ question, includeRaw, deep }, ctx) => {
    await ctx.progress('Loading wiki context');
    const result = await askKb(ctx.vault.path, question, { includeRaw, deep });
    return {
      answerPath: result.answerPath,
      sourcesConsidered: result.sourcesConsidered,
      contextMode: result.contextMode,
      rounds: result.rounds,
      answer: result.answer,
    };
  },
});

const kbLint = defineTool({
  name: 'obs_kb_lint',
  description: 'Health-check the KB: broken wikilinks, orphans, missing frontmatter, duplicate concepts, staleness. Writes a report to outputs/lint/.',
  scope: 'llm',
  schema: {
    staleDays: z.number().int().min(1).optional().describe('Flag concept pages older than this many days (default: 90)'),
    suggest: z.boolean().optional().describe('Use the LLM to rank dangling links into "next to write" suggestions (default: false)'),
    fix: z.boolean().optional().describe('Auto-fix safe issues: frontmatter backfill, tag canon, whitespace (default: false)'),
  },
  handler: async ({ staleDays, suggest, fix }, ctx) => {
    const report = await lintKb(ctx.vault.path, {
      staleDays,
      suggest,
      fix,
      onProgress: msg => { void ctx.progress(msg); },
    });
    return {
      scannedFiles: report.scannedFiles,
      errors: report.errors,
      warnings: report.warnings,
      infos: report.infos,
      reportPath: report.reportPath,
      fixesApplied: report.fixesApplied,
      topFindings: report.findings.slice(0, 20),
    };
  },
});

export const kbLlmTools: Array<ToolDef<ZodRawShape>> = [
  kbIngest,
  kbCompile,
  kbAsk,
  kbLint,
] as unknown as Array<ToolDef<ZodRawShape>>;
