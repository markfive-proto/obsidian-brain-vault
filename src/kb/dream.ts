import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Vault } from '../vault.js';
import { compileKb, findEntriesToCompile, type CompileReport } from './compile.js';
import { lintKb, type LintReport } from './lint.js';
import { resolveEmbedConfig, makeEmbedFn, type EmbedFn } from './embeddings.js';
import { buildIndex, INDEX_DIR, type BuildReport } from './index-store.js';
import { extractTypedEdges } from './graph.js';
import { outputsDir } from './paths.js';
import type { LLMConfig } from './llm.js';

/**
 * The nightly dream cycle: compile a bounded batch of new raw sources, run
 * the health check, refresh stale embeddings, cache the typed-edge graph,
 * and leave a dated log in outputs/dream/. Each phase degrades gracefully —
 * a missing API key skips that phase with a note instead of aborting, so
 * the health steps still run on a machine with no LLM key.
 */

export interface DreamReport {
  dryRun: boolean;
  compile?: CompileReport;
  lint?: LintReport;
  index?: BuildReport;
  graphEdges?: number;
  skipped: Array<{ phase: string; reason: string }>;
  pendingSources: number;
  logPath?: string;
}

export interface DreamOptions {
  dryRun?: boolean;
  compileLimit?: number;
  staleDays?: number;
  config?: LLMConfig;      // LLM config for compile
  embedFn?: EmbedFn;       // injectable for tests
  onProgress?: (msg: string) => void;
}

export async function dreamKb(vaultPath: string, opts: DreamOptions = {}): Promise<DreamReport> {
  const log = opts.onProgress ?? (() => {});
  const vault = new Vault(vaultPath);
  const report: DreamReport = {
    dryRun: opts.dryRun ?? false,
    skipped: [],
    pendingSources: findEntriesToCompile(vaultPath, {}).length,
  };

  // 1. compile a bounded batch
  log(`Dream: compile (pending sources: ${report.pendingSources})`);
  if (report.pendingSources === 0) {
    report.skipped.push({ phase: 'compile', reason: 'no new raw sources' });
  } else {
    try {
      report.compile = await compileKb(vaultPath, {
        limit: opts.compileLimit ?? 3,
        dryRun: opts.dryRun,
        config: opts.config,
        onProgress: log,
      });
    } catch (err) {
      report.skipped.push({ phase: 'compile', reason: (err as Error).message.split('\n')[0] });
    }
  }

  // 2. health check
  if (opts.dryRun) {
    report.skipped.push({ phase: 'lint', reason: 'dry run' });
  } else {
    log('Dream: lint');
    try {
      report.lint = await lintKb(vaultPath, { staleDays: opts.staleDays, onProgress: log });
    } catch (err) {
      report.skipped.push({ phase: 'lint', reason: (err as Error).message.split('\n')[0] });
    }
  }

  // 3. refresh stale embeddings
  if (opts.dryRun) {
    report.skipped.push({ phase: 'index', reason: 'dry run' });
  } else {
    log('Dream: refresh embedding index');
    try {
      const embedFn = opts.embedFn;
      const meta = embedFn
        ? { provider: 'injected', model: 'injected', dimensions: 0 }
        : (() => { const c = resolveEmbedConfig(); return { provider: c.provider, model: c.model, dimensions: c.dimensions }; })();
      report.index = await buildIndex(vault, {
        meta,
        embedFn: embedFn ?? makeEmbedFn(resolveEmbedConfig()),
        onProgress: log,
      });
    } catch (err) {
      report.skipped.push({ phase: 'index', reason: (err as Error).message.split('\n')[0] });
    }
  }

  // 4. cache the typed-edge graph
  if (!opts.dryRun) {
    log('Dream: cache typed-edge graph');
    try {
      const { edges } = await extractTypedEdges(vault);
      report.graphEdges = edges.length;
      const dir = join(vaultPath, INDEX_DIR);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'graph.json'), JSON.stringify({ updatedAt: new Date().toISOString(), edges }), 'utf-8');
    } catch (err) {
      report.skipped.push({ phase: 'graph', reason: (err as Error).message.split('\n')[0] });
    }
  }

  // 5. dream log
  if (!opts.dryRun) {
    const dir = outputsDir(vaultPath, 'dream');
    mkdirSync(dir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const abs = join(dir, `dream-${date}.md`);
    writeFileSync(abs, renderDreamLog(date, report), 'utf-8');
    report.logPath = `outputs/dream/dream-${date}.md`;
    if (!existsSync(abs)) report.skipped.push({ phase: 'log', reason: 'write failed' });
  }

  return report;
}

function renderDreamLog(date: string, r: DreamReport): string {
  const lines: string[] = [
    '---',
    'type: dream-log',
    `date: ${date}`,
    'tags: [output, dream]',
    '---',
    '',
    `# Dream Cycle — ${date}`,
    '',
  ];

  lines.push('## Compile');
  if (r.compile) {
    lines.push(`- Raw sources read: ${r.compile.rawRead}`);
    lines.push(`- Concepts touched: ${r.compile.conceptsTouched} (${r.compile.conceptsNew} new)`);
    for (const p of r.compile.pagesWritten.slice(0, 10)) lines.push(`  - [[${p.split('/').pop()?.replace(/\.md$/, '')}]]`);
    const remaining = r.pendingSources - r.compile.rawRead;
    if (remaining > 0) lines.push(`- Deferred to next run: ${remaining} source(s)`);
  }
  lines.push('');

  lines.push('## Health');
  if (r.lint) {
    lines.push(`- Scanned: ${r.lint.scannedFiles} files`);
    lines.push(`- Errors: ${r.lint.errors} · Warnings: ${r.lint.warnings} · Info: ${r.lint.infos}`);
    lines.push(`- Full report: [[${r.lint.reportPath.split('/').pop()?.replace(/\.md$/, '')}]]`);
    const top = r.lint.findings.filter(f => f.severity === 'error').slice(0, 5);
    for (const f of top) lines.push(`  - ${f.kind}: ${f.path} — ${f.message}`);
  }
  lines.push('');

  lines.push('## Index');
  if (r.index) {
    lines.push(`- Files embedded: ${r.index.filesEmbedded} · unchanged: ${r.index.filesUnchanged} · removed: ${r.index.filesRemoved}`);
  }
  if (r.graphEdges !== undefined) lines.push(`- Typed edges cached: ${r.graphEdges}`);
  lines.push('');

  if (r.skipped.length) {
    lines.push('## Skipped');
    for (const s of r.skipped) lines.push(`- ${s.phase}: ${s.reason}`);
    lines.push('');
  }

  return lines.join('\n') + '\n';
}
