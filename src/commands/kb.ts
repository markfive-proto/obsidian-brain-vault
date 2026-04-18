import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Vault } from '../vault.js';
import { getVaultPath } from '../config.js';
import { output, printError } from '../utils/output.js';
import { extractWikilinks } from '../utils/markdown.js';

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
    .description('Ingest a URL, file, or repo into raw/ (LLM)')
    .option('--type <t>', 'Force type: article|paper|repo|transcript|image|dataset')
    .action((source: string) => {
      printStub(`/clip ${source}`, `Ingesting ${source} into raw/...`);
    });

  kb
    .command('compile')
    .description('Incremental raw → compiled wiki (LLM)')
    .option('--full', 'Re-read everything, ignoring incremental hashes', false)
    .option('--since <duration>', 'Only files changed since (e.g. 7d, 24h)')
    .action(() => {
      printStub('/compile', 'Compiling raw/ into compiled/...');
    });

  kb
    .command('ask <question>')
    .description('Query the wiki; saves answer to outputs/answers/ (LLM)')
    .option('--deep', 'Multi-step research (calls /deep instead of /ask)')
    .action((question: string) => {
      printStub(`/ask ${JSON.stringify(question)}`, 'Querying compiled wiki...');
    });

  kb
    .command('lint')
    .description('Health check; saves report to outputs/lint/')
    .option('--fix', 'Apply safe auto-fixes', false)
    .action(() => {
      printStub('/lint', 'Linting KB...');
    });

  kb
    .command('verify <concept>')
    .description('Fact-check a concept page against its sources (LLM) [phase 3]')
    .action((concept: string) => {
      printStub(`/verify ${concept}`, `Verifying ${concept}...`);
      console.log();
      console.log(chalk.dim('Planned: re-read cited sources, score each claim'));
      console.log(chalk.dim('(supported / partial / unsupported), annotate page'));
      console.log(chalk.dim('with [!unverified] callouts where hallucinations found.'));
    });

  kb
    .command('eval')
    .description('Self-test — generate held-out Q&A, measure wiki IQ (LLM) [phase 3]')
    .option('--samples <n>', 'Number of held-out questions', '25')
    .action(() => {
      printStub('/eval', 'Running self-eval...');
      console.log();
      console.log(chalk.dim('Planned: extract claims from sources, hold out N,'));
      console.log(chalk.dim('generate questions, ask the wiki, score accuracy,'));
      console.log(chalk.dim('log trend to outputs/eval/.'));
    });

  kb
    .command('autohunt')
    .description('Overnight research loop for open questions (LLM) [phase 3]')
    .option('--max-sources <n>', 'Max sources to fetch this run', '10')
    .action(() => {
      printStub('/autohunt', 'Starting autohunt...');
      console.log();
      console.log(chalk.dim('Planned: collect `## Open questions` across compiled/,'));
      console.log(chalk.dim('run autoresearch, ingest discovered sources,'));
      console.log(chalk.dim('recompile, write morning digest to outputs/autohunt/.'));
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
