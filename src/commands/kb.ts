import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Vault } from '../vault.js';
import { getVaultPath } from '../config.js';
import { output, printError } from '../utils/output.js';
import { extractWikilinks } from '../utils/markdown.js';
import { detectSourceType, ingestArticle, type IngestSourceType } from '../kb/ingest.js';
import { ingestPaper } from '../kb/ingest-paper.js';
import { ingestRepo } from '../kb/ingest-repo.js';
import { ingestTranscript } from '../kb/ingest-transcript.js';
import { spiderAvailable, type FetcherKind } from '../kb/fetcher.js';
import { compileKb } from '../kb/compile.js';
import { askKb } from '../kb/ask.js';
import { verifyKb } from '../kb/verify.js';
import { evalKb } from '../kb/eval.js';
import { autohuntKb } from '../kb/autohunt.js';
import { lintKb } from '../kb/lint.js';
import { resolveLLMConfig, type LLMProvider } from '../kb/llm.js';

const KB_DIRS = {
  raw: ['articles', 'papers', 'repos', 'transcripts', 'images', 'datasets'],
  compiled: ['concepts', 'people', 'orgs'],
  outputs: ['answers', 'reports', 'briefs', 'slides', 'charts', 'graphs', 'handbooks', 'lint', 'eval', 'autohunt', 'verify'],
};

const INGEST_LOG_HEADER = `# Ingest Log

One line per ingest. Append-only. Used by \`obs kb compile\` to find new raw sources.

Format: \`- <ISO-date>  <type>  <path>  "<title>"\`

---

`;

const COMPILE_LOG_HEADER = `# Compile Log

One line per compile run. Append-only.

Format: \`- <ISO-date>  run=<mode>  raw_added=<N>  concepts_touched=<N>  concepts_new=<N>\`

---

`;

const INDEX_STUB = `---
title: Knowledge Base Index
type: moc
tags: [kb, index]
---

# Knowledge Base Index

Run \`obs kb compile\` to populate this. The LLM will scan \`raw/\` and build concept pages under \`compiled/concepts/\`, people under \`compiled/people/\`, orgs under \`compiled/orgs/\`, and rebuild this index.

## Sections

*Concepts, People, Orgs will appear here after first compile.*
`;

const KB_README = `# Knowledge Base

This folder implements the Karpathy LLM-wiki method (raw → compiled → outputs) via the \`obs kb\` command family.

## Layout

\`\`\`
raw/        source material you ingest (immutable)
compiled/   LLM-written wiki (concept pages, people, orgs, glossary)
outputs/    generated answers, slides, charts, lint reports
\`\`\`

## Daily loop

\`\`\`bash
obs kb ingest <url>      # add a source
obs kb compile           # fold it into the wiki
obs kb ask "question"    # query the wiki, result saved to outputs/answers
obs kb lint              # health check
\`\`\`

See \`obs kb --help\` for all commands.
`;

function kbRoot(vaultPath: string): string {
  // KB lives at vault root — portable, human-inspectable.
  return vaultPath;
}

function countFilesRecursive(dir: string): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) n += countFilesRecursive(full);
    else if (entry.name.endsWith('.md')) n += 1;
  }
  return n;
}

function listMarkdownRecursive(dir: string, root: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMarkdownRecursive(full, root));
    else if (entry.name.endsWith('.md')) out.push(full.slice(root.length + 1));
  }
  return out;
}

function printStub(skillSlashCommand: string, summary: string): void {
  console.log(chalk.yellow(summary));
  console.log();
  console.log(chalk.dim('This command will be implemented natively in a future release.'));
  console.log(chalk.dim('For now, run the equivalent Claude Code skill:'));
  console.log();
  console.log(chalk.cyan(`  ${skillSlashCommand}`));
  console.log();
  console.log(chalk.dim('The skill lives at: obsidian-vault-cli/skills/'));
}

export function registerKbCommands(program: Command): void {
  const kb = program
    .command('kb')
    .description('Knowledge Base — Karpathy-style raw→compiled wiki workflow')
    .addHelpText('after', `
The \`obs kb\` family implements Andrej Karpathy's LLM Wiki pattern as a Unix
tool. Raw source material lands in \`raw/\`, an LLM compiles it incrementally
into a concept wiki under \`compiled/\`, and queries write answers back into
\`outputs/\` so explorations compound.

Commands:
  init         Scaffold raw/ compiled/ outputs/ in the current vault
  stats        Counts + health summary
  list         List raw/ compiled/ outputs/ entries
  ingest       Add a source (URL, PDF, image, repo)                [LLM]
  compile      Incremental raw → wiki compile                      [LLM]
  ask          Query the wiki; save answer to outputs/answers/     [LLM]
  lint         Health check; save report to outputs/lint/          [mixed]
  verify       Fact-check a concept page against its sources       [LLM]
  eval         Self-test; generate held-out Q&A and measure IQ     [LLM]
  autohunt     Overnight research loop for open questions          [LLM]
  publish      Render outputs as slides / blog / newsletter        [LLM]
  watch        Re-compile when raw/ changes                        [daemon]

Examples:
  $ obs kb init
  $ obs kb ingest https://karpathy.ai/...
  $ obs kb compile
  $ obs kb ask "what does my KB say about X?"
  $ obs kb lint --json | jq '.summary'

[LLM] commands call a configured LLM provider and currently delegate to the
bundled Claude Code skills. Native implementations (phase 2) will call the
provider SDK directly and expose all ops as MCP tools.
`);

  // ---- init ---------------------------------------------------------------
  kb
    .command('init')
    .description('Scaffold raw/, compiled/, outputs/ folders in the current vault')
    .option('--force', 'Overwrite existing scaffold files', false)
    .action((opts: { force: boolean }) => {
      try {
        const vaultPath = getVaultPath(program.opts().vault);
        const vault = new Vault(vaultPath);
        if (!vault.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        const root = kbRoot(vaultPath);
        const created: string[] = [];
        const skipped: string[] = [];

        const ensureDir = (rel: string) => {
          const full = join(root, rel);
          if (!existsSync(full)) {
            mkdirSync(full, { recursive: true });
            created.push(rel);
          } else {
            skipped.push(rel);
          }
        };

        for (const [top, subs] of Object.entries(KB_DIRS)) {
          ensureDir(top);
          for (const s of subs) ensureDir(join(top, s));
        }

        const ensureFile = (rel: string, content: string) => {
          const full = join(root, rel);
          if (!existsSync(full) || opts.force) {
            writeFileSync(full, content, 'utf-8');
            created.push(rel);
          } else {
            skipped.push(rel);
          }
        };

        ensureFile('raw/INGEST-LOG.md', INGEST_LOG_HEADER);
        ensureFile('compiled/00-INDEX.md', INDEX_STUB);
        ensureFile('compiled/COMPILE-LOG.md', COMPILE_LOG_HEADER);
        ensureFile('README-KB.md', KB_README);

        const jsonMode = program.opts().json;
        if (jsonMode) {
          output(JSON.stringify({ created, skipped }, null, 2), jsonMode);
          return;
        }

        console.log(chalk.green(`KB scaffold ready at ${root}`));
        if (created.length) {
          console.log();
          console.log(chalk.bold('Created:'));
          for (const c of created) console.log(`  + ${c}`);
        }
        if (skipped.length) {
          console.log();
          console.log(chalk.dim(`Skipped ${skipped.length} existing path(s) (use --force to overwrite)`));
        }
        console.log();
        console.log(chalk.dim('Next:'));
        console.log(chalk.cyan('  obs kb ingest <url>'));
        console.log(chalk.cyan('  obs kb compile'));
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  // ---- stats --------------------------------------------------------------
  kb
    .command('stats')
    .description('Summary counts + health for raw/, compiled/, outputs/')
    .action(async () => {
      try {
        const vaultPath = getVaultPath(program.opts().vault);
        const root = kbRoot(vaultPath);
        const jsonMode = program.opts().json;

        const stats = {
          raw: countFilesRecursive(join(root, 'raw')),
          compiled: {
            concepts: countFilesRecursive(join(root, 'compiled', 'concepts')),
            people: countFilesRecursive(join(root, 'compiled', 'people')),
            orgs: countFilesRecursive(join(root, 'compiled', 'orgs')),
          },
          outputs: countFilesRecursive(join(root, 'outputs')),
          scaffolded: existsSync(join(root, 'compiled', '00-INDEX.md')),
        };

        // dangling wikilinks = [[x]] whose target file doesn't exist anywhere
        const vault = new Vault(vaultPath);
        const allFiles = new Set(await vault.listFiles());
        const allBasenames = new Set<string>();
        for (const f of allFiles) {
          const base = f.split('/').pop()?.replace(/\.md$/, '') ?? '';
          if (base) allBasenames.add(base);
        }

        let dangling = 0;
        let totalLinks = 0;
        for (const f of allFiles) {
          if (!f.startsWith('compiled/') && !f.startsWith('raw/')) continue;
          try {
            const body = vault.readFileRaw(f);
            for (const link of extractWikilinks(body)) {
              totalLinks += 1;
              if (!allBasenames.has(link.target)) dangling += 1;
            }
          } catch {
            // ignore
          }
        }

        const summary = {
          ...stats,
          totalWikilinks: totalLinks,
          danglingWikilinks: dangling,
        };

        if (jsonMode) {
          output(JSON.stringify(summary, null, 2), jsonMode);
          return;
        }

        console.log(chalk.bold('Knowledge Base stats'));
        console.log();
        console.log(`  Raw sources:       ${chalk.cyan(String(stats.raw))}`);
        console.log(`  Concept pages:     ${chalk.cyan(String(stats.compiled.concepts))}`);
        console.log(`  People pages:      ${chalk.cyan(String(stats.compiled.people))}`);
        console.log(`  Org pages:         ${chalk.cyan(String(stats.compiled.orgs))}`);
        console.log(`  Output artifacts:  ${chalk.cyan(String(stats.outputs))}`);
        console.log();
        console.log(`  Total wikilinks:   ${totalLinks}`);
        console.log(`  Dangling links:    ${dangling === 0 ? chalk.green('0') : chalk.red(String(dangling))}`);
        if (!stats.scaffolded) {
          console.log();
          console.log(chalk.yellow('KB not scaffolded. Run: obs kb init'));
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  // ---- list ---------------------------------------------------------------
  const list = kb.command('list').description('List KB files');
  list
    .command('raw')
    .description('List files in raw/')
    .action(() => {
      const root = kbRoot(getVaultPath(program.opts().vault));
      const files = listMarkdownRecursive(join(root, 'raw'), root);
      const jsonMode = program.opts().json;
      if (jsonMode) return output(JSON.stringify(files, null, 2), jsonMode);
      for (const f of files) console.log(f);
      if (!files.length) console.log(chalk.dim('(empty)'));
    });
  list
    .command('concepts')
    .description('List concept pages')
    .action(() => {
      const root = kbRoot(getVaultPath(program.opts().vault));
      const files = listMarkdownRecursive(join(root, 'compiled', 'concepts'), root);
      const jsonMode = program.opts().json;
      if (jsonMode) return output(JSON.stringify(files, null, 2), jsonMode);
      for (const f of files) console.log(f);
      if (!files.length) console.log(chalk.dim('(empty — run `obs kb compile`)'));
    });
  list
    .command('outputs')
    .description('List generated outputs')
    .action(() => {
      const root = kbRoot(getVaultPath(program.opts().vault));
      const files = listMarkdownRecursive(join(root, 'outputs'), root);
      const jsonMode = program.opts().json;
      if (jsonMode) return output(JSON.stringify(files, null, 2), jsonMode);
      for (const f of files) console.log(f);
      if (!files.length) console.log(chalk.dim('(empty)'));
    });

  // ---- LLM-backed stubs (phase 1) -----------------------------------------
  // These print a helpful message pointing to the equivalent skill until
  // native implementations land in phase 2 (LiteLLM / Anthropic SDK direct).

  kb
    .command('ingest <source>')
    .description('Ingest a URL, file, or repo into raw/')
    .option('--type <t>', 'Force type: article|paper|repo|transcript|image|dataset')
    .option('--overwrite', 'Overwrite an existing file with the same slug', false)
    .option('--fetcher <f>', 'HTML fetcher: spider | defuddle | auto (default)', 'auto')
    .action(async (source: string, opts: { type?: string; overwrite: boolean; fetcher: string }) => {
      try {
        const vaultPath = getVaultPath(program.opts().vault);
        const vault = new Vault(vaultPath);
        if (!vault.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        const sourceType = (opts.type as IngestSourceType | undefined) ?? detectSourceType(source);
        const jsonMode = program.opts().json;
        const fetcherKind = opts.fetcher as FetcherKind;
        if (!['spider', 'defuddle', 'auto'].includes(fetcherKind)) {
          printError(`Unknown --fetcher value "${opts.fetcher}". Use: spider | defuddle | auto`);
          process.exit(1);
        }

        const renderResult = (res: { path: string; title: string; wordCount: number; duplicate?: boolean; fetchedVia?: string }) => {
          if (jsonMode) {
            output(JSON.stringify(res, null, 2), jsonMode);
            return;
          }
          if (res.duplicate) {
            console.log(chalk.yellow(`Already ingested: ${res.path}`));
            console.log(chalk.dim('(Use --overwrite to replace.)'));
          } else {
            console.log(chalk.green(`Ingested: ${res.path}`));
            console.log(`  Title:       ${res.title}`);
            console.log(`  Word count:  ${res.wordCount.toLocaleString()}`);
            if (res.fetchedVia) console.log(chalk.dim(`  Fetched via: ${res.fetchedVia}`));
          }
          console.log();
          console.log(chalk.dim('Next: obs kb compile'));
        };

        if (sourceType === 'article') {
          const resolvedFetcher =
            fetcherKind === 'auto' ? (spiderAvailable() ? 'spider' : 'defuddle') : fetcherKind;
          if (!jsonMode) {
            console.log(chalk.dim(`Ingesting article (fetch: ${resolvedFetcher}, extract: defuddle)`));
            console.log(chalk.dim(source));
          }
          const result = await ingestArticle(vaultPath, source, {
            overwrite: opts.overwrite,
            fetcher: fetcherKind,
          });
          renderResult(result);
          return;
        }

        if (sourceType === 'paper') {
          if (!jsonMode) console.log(chalk.dim(`Ingesting paper (pdftotext + arXiv metadata when available): ${source}`));
          const result = await ingestPaper(vaultPath, source, { overwrite: opts.overwrite });
          renderResult(result);
          return;
        }

        if (sourceType === 'repo') {
          if (!jsonMode) console.log(chalk.dim(`Ingesting repo via gh api: ${source}`));
          const result = await ingestRepo(vaultPath, source, { overwrite: opts.overwrite });
          renderResult(result);
          return;
        }

        if (sourceType === 'transcript') {
          if (!jsonMode) console.log(chalk.dim(`Ingesting transcript via yt-dlp auto-captions: ${source}`));
          const result = await ingestTranscript(vaultPath, source, { overwrite: opts.overwrite });
          renderResult(result);
          return;
        }

        // Remaining types (image, dataset) still route to the skill pack.
        const skillMap: Record<IngestSourceType, string> = {
          article: '/clip',
          paper: '/paper',
          repo: '/repo',
          transcript: '/transcript',
          image: '/image',
          dataset: '/dataset',
        };
        printStub(`${skillMap[sourceType]} ${source}`, `Ingesting ${sourceType} (${source})...`);
        console.log();
        console.log(chalk.dim(`Native ${sourceType} ingest lands in a future phase. Article / paper / repo / transcript are live.`));
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  kb
    .command('compile')
    .description('Incremental raw → compiled wiki (LLM)')
    .option('--full', 'Re-read every raw source (ignore incremental cursor)', false)
    .option('--since <iso-date>', 'Only raw sources ingested after this timestamp')
    .option('--dry-run', 'Print what would change without writing files', false)
    .option('--provider <p>', 'LLM provider: anthropic | openai | google (env OBS_LLM_PROVIDER overrides)')
    .option('--model <m>', 'Model id override (env OBS_LLM_MODEL overrides)')
    .action(async (opts: {
      full: boolean;
      since?: string;
      dryRun: boolean;
      provider?: string;
      model?: string;
    }) => {
      try {
        const vaultPath = getVaultPath(program.opts().vault);
        const vault = new Vault(vaultPath);
        if (!vault.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        const jsonMode = program.opts().json;
        const config = resolveLLMConfig({
          provider: opts.provider as LLMProvider | undefined,
          model: opts.model,
        });

        if (!jsonMode) {
          console.log(chalk.dim(`Compile: ${config.provider}/${config.model}${opts.full ? ' (full)' : ''}${opts.dryRun ? ' (dry-run)' : ''}`));
        }

        const report = await compileKb(vaultPath, {
          full: opts.full,
          since: opts.since,
          dryRun: opts.dryRun,
          config,
          onProgress: jsonMode ? undefined : msg => console.log(chalk.dim(msg)),
        });

        if (jsonMode) {
          output(JSON.stringify(report, null, 2), jsonMode);
          return;
        }

        console.log();
        console.log(chalk.green(`Compile complete`));
        console.log(`  Raw sources read:    ${report.rawRead}`);
        console.log(`  Concepts touched:    ${report.conceptsTouched}`);
        console.log(`  New concept pages:   ${report.conceptsNew}`);
        if (report.skipped.length) {
          console.log(chalk.yellow(`  Skipped:             ${report.skipped.length}`));
          for (const s of report.skipped.slice(0, 5)) {
            console.log(chalk.dim(`    - ${s.path}: ${s.reason}`));
          }
        }
        if (report.pagesWritten.length && report.pagesWritten.length <= 15) {
          console.log();
          console.log(chalk.dim('Pages written/updated:'));
          for (const p of report.pagesWritten) console.log(`  ${p}`);
        }
        console.log();
        console.log(chalk.dim('Next: obs kb ask "your question"'));
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  kb
    .command('ask <question>')
    .description('Query the wiki; saves answer to outputs/answers/ (LLM)')
    .option('--include-raw', 'Also include raw/ sources in the context (deeper, more tokens)', false)
    .option('--budget <bytes>', 'Max bytes of wiki context to send to the model', '280000')
    .option('--no-backlinks', 'Do not append a backlink from cited concept pages')
    .option('--provider <p>', 'LLM provider: anthropic | openai | google')
    .option('--model <m>', 'Model id override')
    .action(async (
      question: string,
      opts: { includeRaw: boolean; budget: string; backlinks: boolean; provider?: string; model?: string },
    ) => {
      try {
        const vaultPath = getVaultPath(program.opts().vault);
        const vault = new Vault(vaultPath);
        if (!vault.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }
        const jsonMode = program.opts().json;
        const config = resolveLLMConfig({
          provider: opts.provider as LLMProvider | undefined,
          model: opts.model,
        });

        if (!jsonMode) {
          console.log(chalk.dim(`Asking ${config.provider}/${config.model}: ${JSON.stringify(question)}`));
        }

        const result = await askKb(vaultPath, question, {
          includeRaw: opts.includeRaw,
          budgetBytes: parseInt(opts.budget, 10) || 280_000,
          addBacklinks: opts.backlinks,
          config,
        });

        if (jsonMode) {
          output(JSON.stringify(result, null, 2), jsonMode);
          return;
        }

        console.log();
        console.log(chalk.green(result.answer.restatedQuestion));
        console.log();
        console.log(chalk.bold('TL;DR'));
        for (const b of result.answer.tldrBullets) console.log(`  • ${b}`);
        console.log();
        console.log(chalk.bold('Confidence:'), result.answer.confidence);
        console.log(chalk.dim(result.answer.confidenceReason));
        console.log();
        console.log(chalk.dim(`Consulted ${result.sourcesConsidered} wiki item(s), ${result.contextBytes.toLocaleString()} bytes of context.`));
        console.log();
        console.log(chalk.green(`Full answer saved to ${result.answerPath}`));
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  kb
    .command('lint')
    .description('Health check; saves report to outputs/lint/')
    .option('--fix', 'Apply safe auto-fixes (frontmatter backfill, tag canon, trailing ws)', false)
    .option('--suggest', 'Run LLM next-to-write suggestions', false)
    .option('--stale-days <n>', 'Pages older than N days count as stale', '90')
    .option('--provider <p>', 'LLM provider (only if --suggest)')
    .option('--model <m>', 'Model id override')
    .action(async (opts: { fix: boolean; suggest: boolean; staleDays: string; provider?: string; model?: string }) => {
      try {
        const vaultPath = getVaultPath(program.opts().vault);
        const vault = new Vault(vaultPath);
        if (!vault.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }
        const jsonMode = program.opts().json;
        const config = opts.suggest
          ? resolveLLMConfig({ provider: opts.provider as LLMProvider | undefined, model: opts.model })
          : undefined;
        const report = await lintKb(vaultPath, {
          fix: opts.fix,
          suggest: opts.suggest,
          staleDays: parseInt(opts.staleDays, 10) || 90,
          config,
          onProgress: jsonMode ? undefined : msg => console.error(chalk.dim(msg)),
        });
        if (jsonMode) {
          output(JSON.stringify(report, null, 2), jsonMode);
          return;
        }
        console.log();
        console.log(chalk.green('Lint complete'));
        console.log(`  Scanned:             ${report.scannedFiles}`);
        console.log(`  Errors:              ${chalk.red(String(report.errors))}`);
        console.log(`  Warnings:            ${chalk.yellow(String(report.warnings))}`);
        console.log(`  Info:                ${report.infos}`);
        if (report.fixesApplied.length) console.log(`  Fixes applied:       ${chalk.cyan(String(report.fixesApplied.length))}`);
        console.log();
        console.log(chalk.dim(`Report: ${report.reportPath}`));
        if (report.errors > 0) process.exit(1);
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  kb
    .command('verify')
    .description('Fact-check concept pages against their cited sources (LLM)')
    .option('--concept <slug>', 'Single concept (slug, filename, or absolute path)')
    .option('--all', 'Verify every concept page', false)
    .option('--no-annotate', 'Do not write callouts into the concept page')
    .option('--provider <p>', 'LLM provider')
    .option('--model <m>', 'Model id override')
    .action(async (opts: { concept?: string; all: boolean; annotate: boolean; provider?: string; model?: string }) => {
      try {
        const vaultPath = getVaultPath(program.opts().vault);
        const vault = new Vault(vaultPath);
        if (!vault.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }
        if (!opts.concept && !opts.all) {
          printError('Pass --concept <slug> or --all.');
          process.exit(1);
        }
        const jsonMode = program.opts().json;
        const config = resolveLLMConfig({ provider: opts.provider as LLMProvider | undefined, model: opts.model });
        const report = await verifyKb(vaultPath, {
          concept: opts.concept,
          all: opts.all,
          annotate: opts.annotate,
          config,
          onProgress: jsonMode ? undefined : msg => console.error(chalk.dim(msg)),
        });
        if (jsonMode) {
          output(JSON.stringify(report, null, 2), jsonMode);
          return;
        }
        console.log();
        console.log(chalk.green('Verify complete'));
        console.log(`  Concepts scanned:    ${report.conceptsScanned}`);
        console.log(`  Claims checked:      ${report.claimsChecked}`);
        console.log(`  Supported:           ${chalk.green(String(report.supported))}`);
        console.log(`  Partial:             ${chalk.yellow(String(report.partial))}`);
        console.log(`  Unsupported:         ${chalk.red(String(report.unsupported))}`);
        console.log(`  Missing source:      ${report.missingSource}`);
        console.log();
        if (report.reportPaths.length <= 5) for (const p of report.reportPaths) console.log(chalk.dim(`  Report: ${p}`));
        else console.log(chalk.dim(`  ${report.reportPaths.length} reports written to outputs/verify/`));
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  kb
    .command('eval')
    .description('Self-test — generate held-out Q&A, measure wiki IQ over time (LLM)')
    .option('--samples <n>', 'Number of questions to generate', '20')
    .option('--seed <n>', 'Seed for reproducible source sampling', '1')
    .option('--provider <p>', 'LLM provider')
    .option('--model <m>', 'Model id override')
    .option('--fail-under <n>', 'Exit non-zero if IQ score is below this threshold (0-1)')
    .action(async (opts: { samples: string; seed: string; provider?: string; model?: string; failUnder?: string }) => {
      try {
        const vaultPath = getVaultPath(program.opts().vault);
        const vault = new Vault(vaultPath);
        if (!vault.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }
        const jsonMode = program.opts().json;
        const config = resolveLLMConfig({ provider: opts.provider as LLMProvider | undefined, model: opts.model });
        const report = await evalKb(vaultPath, {
          samples: parseInt(opts.samples, 10) || 20,
          seed: parseInt(opts.seed, 10) || 1,
          config,
          onProgress: jsonMode ? undefined : msg => console.error(chalk.dim(msg)),
        });
        if (jsonMode) {
          output(JSON.stringify(report, null, 2), jsonMode);
          return;
        }
        console.log();
        console.log(chalk.green('Eval complete'));
        console.log(`  Samples:             ${report.samples}`);
        console.log(`  IQ score:            ${chalk.cyan((report.iqScore * 100).toFixed(1) + '%')} (${report.correct}/${report.samples})`);
        console.log(`  Citation precision:  ${(report.citationPrecision * 100).toFixed(1)}%`);
        console.log(`  Citation recall:     ${(report.citationRecall * 100).toFixed(1)}%`);
        console.log();
        console.log(chalk.dim(`Report: ${report.reportPath}`));
        console.log(chalk.dim(`Trend:  ${report.trendPath}`));
        const failUnder = opts.failUnder ? parseFloat(opts.failUnder) : undefined;
        if (failUnder !== undefined && report.iqScore < failUnder) {
          console.log(chalk.red(`\nIQ ${report.iqScore.toFixed(2)} below threshold ${failUnder}`));
          process.exit(1);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  kb
    .command('autohunt')
    .description('Overnight research loop: hunt sources for open questions, compile (LLM + web)')
    .option('--max-questions <n>', 'Max open questions to chase this run', '3')
    .option('--max-sources <n>', 'Max candidate URLs to ingest per question', '3')
    .option('--skip-compile', 'Skip the final compile step', false)
    .option('--provider <p>', 'LLM provider')
    .option('--model <m>', 'Model id override')
    .action(async (opts: { maxQuestions: string; maxSources: string; skipCompile: boolean; provider?: string; model?: string }) => {
      try {
        const vaultPath = getVaultPath(program.opts().vault);
        const vault = new Vault(vaultPath);
        if (!vault.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }
        const jsonMode = program.opts().json;
        const config = resolveLLMConfig({ provider: opts.provider as LLMProvider | undefined, model: opts.model });
        const report = await autohuntKb(vaultPath, {
          maxQuestions: parseInt(opts.maxQuestions, 10) || 3,
          maxSourcesPerQuestion: parseInt(opts.maxSources, 10) || 3,
          skipCompile: opts.skipCompile,
          config,
          onProgress: jsonMode ? undefined : msg => console.error(chalk.dim(msg)),
        });
        if (jsonMode) {
          output(JSON.stringify(report, null, 2), jsonMode);
          return;
        }
        console.log();
        console.log(chalk.green('Autohunt complete'));
        console.log(`  Questions collected: ${report.questionsCollected}`);
        console.log(`  Questions chased:    ${report.questionsChosen}`);
        console.log(`  URLs attempted:      ${report.urlsAttempted}`);
        console.log(`  Sources ingested:    ${chalk.cyan(String(report.sourcesIngested))}`);
        console.log(`  Recompiled:          ${report.recompiled ? chalk.green('yes') : chalk.yellow('no')}`);
        console.log();
        console.log(chalk.dim(`Digest: ${report.digestPath}`));
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  kb
    .command('publish <source>')
    .description('Render a concept or answer as slides/blog/newsletter (LLM) [phase 3]')
    .option('--format <f>', 'slides|blog|newsletter|tweet-thread|linkedin', 'blog')
    .action((source: string, opts: { format: string }) => {
      printStub(`/slides ${source}`, `Rendering ${source} as ${opts.format}...`);
    });

  kb
    .command('watch')
    .description('Re-compile automatically when raw/ changes (daemon) [phase 2]')
    .action(() => {
      console.log(chalk.yellow('Watch daemon not yet implemented.'));
      console.log(chalk.dim('For now, re-run `obs kb compile` after each ingest.'));
    });
}
