import { Command } from 'commander';
import chalk from 'chalk';
import { homedir } from 'node:os';
import {
  ALL_EDITORS,
  detectEditors,
  patchEditor,
  patchAllDetected,
  type Editor,
  type PatchOptions,
  type PatchResult,
  type EditorDetection,
} from '../setup/editors.js';
import { output, printError } from '../utils/output.js';

const EDITOR_LABELS: Record<Editor, string> = {
  'claude-desktop': 'Claude Desktop',
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  codex: 'Codex',
  opencode: 'OpenCode',
};

function shortenHome(p: string): string {
  const home = homedir();
  if (p.startsWith(home)) return '~' + p.slice(home.length);
  return p;
}

interface CliOpts {
  editor?: string;
  vault?: string;
  noVault?: boolean;
  force?: boolean;
  dryRun?: boolean;
  json?: boolean;
  yes?: boolean;
}

function resolveVault(opts: CliOpts): string | null {
  if (opts.noVault) return null;
  if (opts.vault && opts.vault.length > 0) return opts.vault;
  return null; // default: omit --vault; MCP reads workspace default
}

function buildPatchOptions(opts: CliOpts): PatchOptions {
  return {
    serverName: 'obs',
    command: 'obs-mcp',
    vaultPath: resolveVault(opts),
    dryRun: Boolean(opts.dryRun),
    force: Boolean(opts.force),
  };
}

function parseEditor(name: string | undefined): Editor | null {
  if (!name) return null;
  const normalized = name.toLowerCase() as Editor;
  return ALL_EDITORS.includes(normalized) ? normalized : null;
}

function renderDetectionRow(d: EditorDetection): string {
  const label = EDITOR_LABELS[d.editor].padEnd(20);
  if (!d.installed) {
    return `  ${chalk.red('x')} ${label} ${chalk.dim('(not installed)')}`;
  }
  const path = shortenHome(d.configPath);
  const status = d.alreadyConfigured
    ? chalk.dim('already configured')
    : chalk.green('will add obs');
  return `  ${chalk.green('v')} ${label} ${path.padEnd(60)}  ${status}`;
}

function renderResultLine(r: PatchResult): string {
  const label = EDITOR_LABELS[r.editor].padEnd(20);
  const mark = r.changed ? chalk.green('v') : chalk.yellow('-');
  const path = shortenHome(r.configPath);
  return `  ${mark} ${label} ${path}  ${chalk.dim(r.reason ?? '')}`;
}

function runList(opts: CliOpts): void {
  const detections = detectEditors('obs');
  if (opts.json) {
    output(detections, { json: true });
    return;
  }
  console.log(chalk.bold('Detected editors:'));
  for (const d of detections) {
    console.log(renderDetectionRow(d));
  }
}

function runSetup(opts: CliOpts): void {
  const patchOpts = buildPatchOptions(opts);
  const only = parseEditor(opts.editor);
  if (opts.editor && !only) {
    printError(
      `unknown editor '${opts.editor}'. Valid: ${ALL_EDITORS.join(', ')}`
    );
    process.exitCode = 1;
    return;
  }

  const results: PatchResult[] = only
    ? [patchEditor(only, patchOpts)]
    : patchAllDetected(patchOpts);

  if (opts.json) {
    output(results, { json: true });
    return;
  }

  if (opts.dryRun) {
    console.log(chalk.bold('Dry run — no files written:'));
  } else {
    console.log(chalk.bold('Setup results:'));
  }
  for (const r of results) {
    console.log(renderResultLine(r));
  }

  const note = patchOpts.vaultPath
    ? chalk.dim(`\nUsed --vault ${patchOpts.vaultPath}`)
    : chalk.dim(
        '\nNo --vault set; MCP server will read workspace default at runtime.'
      );
  console.log(note);
}

export function registerSetupCommands(program: Command): void {
  const setup = program
    .command('setup')
    .description(
      'Auto-configure obs-mcp in every detected AI editor (Claude Desktop, Claude Code, Cursor, Windsurf, Codex, OpenCode).'
    )
    .option('--editor <name>', 'only configure the named editor')
    .option('--vault <path>', 'absolute vault path for --vault flag')
    .option(
      '--no-vault',
      'omit the --vault flag (MCP reads workspace default)'
    )
    .option('--force', 'overwrite existing obs entries')
    .option('--dry-run', 'show what would change without writing')
    .option('--json', 'machine-readable output')
    .action((opts: CliOpts) => {
      runSetup(opts);
    });

  setup
    .command('list')
    .description('list detected editors and whether obs is already configured')
    .option('--json', 'machine-readable output')
    .action((opts: CliOpts) => {
      runList(opts);
    });
}
