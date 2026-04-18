import { Command } from 'commander';
import { basename, resolve, join } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import {
  loadWorkspace,
  saveWorkspace,
  addVault,
  removeVault,
  findVault,
  setDefaultVault,
  isValidVaultName,
  type VaultKind,
  type VaultEntry,
  type Workspace,
} from '../workspace.js';
import { output, printTable, printError, printSuccess } from '../utils/output.js';

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'vault';
}

function uniqueName(base: string, ws: Workspace): string {
  if (!findVault(ws, base)) return base;
  let i = 2;
  while (findVault(ws, `${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function detectKind(absPath: string): VaultKind {
  if (existsSync(join(absPath, '.obsidian'))) return 'vault';
  if (existsSync(join(absPath, '.git'))) return 'project';
  return 'topic';
}

function isValidKindFlag(value: string): value is VaultKind {
  return value === 'project' || value === 'topic' || value === 'vault';
}

interface AddOpts {
  name?: string;
  kind?: string;
  description?: string;
  default?: boolean;
}

export function registerWorkspaceCommands(program: Command): void {
  const ws = program
    .command('workspace')
    .description('Manage the universe of vaults (~/.obs/)')
    .addHelpText('after', `
Examples:
  $ obs workspace add ~/projects/my-app --default
  $ obs workspace add ~/notes --name brain --kind topic
  $ obs workspace list
  $ obs workspace use brain
  $ obs workspace where brain`);

  ws
    .command('add <path>')
    .description('Register a vault in the workspace')
    .option('--name <name>', 'Vault name (defaults to directory basename, slugified)')
    .option('--kind <kind>', 'Vault kind: project | topic | vault (auto-detected)')
    .option('--description <text>', 'Optional one-liner description')
    .option('--default', 'Set this vault as the default')
    .action((vaultPath: string, cmdOpts: AddOpts) => {
      const opts = program.opts();
      const jsonMode = opts.json;

      try {
        const absPath = resolve(vaultPath);
        if (!existsSync(absPath)) {
          printError(`Path does not exist: ${absPath}`);
          process.exit(1);
        }
        if (!statSync(absPath).isDirectory()) {
          printError(`Path is not a directory: ${absPath}`);
          process.exit(1);
        }

        let kind: VaultKind;
        if (cmdOpts.kind) {
          if (!isValidKindFlag(cmdOpts.kind)) {
            printError(`Invalid --kind: ${cmdOpts.kind}. Must be: project, topic, or vault.`);
            process.exit(1);
          }
          kind = cmdOpts.kind;
        } else {
          kind = detectKind(absPath);
        }

        let workspace = loadWorkspace();

        let name: string;
        if (cmdOpts.name) {
          if (!isValidVaultName(cmdOpts.name)) {
            printError(`Invalid --name: ${cmdOpts.name}. Use lowercase letters, digits, and hyphens (1-60 chars).`);
            process.exit(1);
          }
          name = cmdOpts.name;
        } else {
          name = uniqueName(slugify(basename(absPath)), workspace);
        }

        workspace = addVault(workspace, {
          name,
          path: absPath,
          kind,
          description: cmdOpts.description,
        });

        if (cmdOpts.default || workspace.default === null) {
          workspace = setDefaultVault(workspace, name);
        }

        saveWorkspace(workspace);
        const entry = findVault(workspace, name) as VaultEntry;

        if (jsonMode) {
          output({ added: entry, default: workspace.default }, { json: true });
        } else {
          printSuccess(`Registered vault "${name}" (${kind}) at ${absPath}`);
          if (workspace.default === name) {
            console.log(`Default vault: ${name}`);
          }
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  ws
    .command('list')
    .description('List vaults in the workspace')
    .option('--json', 'Output as JSON')
    .action((cmdOpts: { json?: boolean }) => {
      const opts = program.opts();
      const jsonMode = opts.json || cmdOpts.json;

      try {
        const workspace = loadWorkspace();
        if (jsonMode) {
          output(workspace.vaults.map(v => ({
            ...v,
            default: workspace.default === v.name,
          })), { json: true });
          return;
        }

        if (workspace.vaults.length === 0) {
          console.log('No vaults registered. Use "obs workspace add <path>" to register one.');
          return;
        }

        const rows = workspace.vaults.map(v => [
          v.name,
          v.kind,
          v.path,
          workspace.default === v.name ? 'yes' : '',
          v.description ?? '',
        ]);
        printTable(['Name', 'Kind', 'Path', 'Default', 'Description'], rows);
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  ws
    .command('remove <name>')
    .description('Remove a vault from the workspace (does not delete the folder)')
    .option('--force', 'Skip confirmation')
    .action((name: string, cmdOpts: { force?: boolean }) => {
      try {
        let workspace = loadWorkspace();
        const entry = findVault(workspace, name);
        if (!entry) {
          printError(`No vault named "${name}".`);
          process.exit(1);
        }
        if (!cmdOpts.force) {
          // Non-interactive safety: require --force for now.
          printError(`Refusing to remove without --force. Run: obs workspace remove ${name} --force`);
          process.exit(1);
        }
        const wasDefault = workspace.default === name;
        workspace = removeVault(workspace, name);
        saveWorkspace(workspace);
        printSuccess(`Removed vault "${name}".`);
        if (wasDefault) {
          console.log('Default vault cleared. Set a new default with: obs workspace use <name>');
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  const useAction = (name: string): void => {
    try {
      let workspace = loadWorkspace();
      workspace = setDefaultVault(workspace, name);
      saveWorkspace(workspace);
      printSuccess(`Default vault set to "${name}".`);
    } catch (err) {
      printError((err as Error).message);
      process.exit(1);
    }
  };

  ws
    .command('use <name>')
    .description('Set the default vault')
    .action(useAction);

  ws
    .command('switch <name>')
    .description('Alias for "use"')
    .action(useAction);

  ws
    .command('info [name]')
    .description('Show full info for a vault (defaults to the current default)')
    .action((name: string | undefined) => {
      const opts = program.opts();
      const jsonMode = opts.json;

      try {
        const workspace = loadWorkspace();
        const target = name ?? workspace.default;
        if (!target) {
          printError('No default vault set and no name given.');
          process.exit(1);
        }
        const entry = findVault(workspace, target);
        if (!entry) {
          printError(`No vault named "${target}".`);
          process.exit(1);
        }
        if (jsonMode) {
          output({ ...entry, default: workspace.default === entry.name }, { json: true });
          return;
        }
        console.log(`Name:        ${entry.name}`);
        console.log(`Kind:        ${entry.kind}`);
        console.log(`Path:        ${entry.path}`);
        console.log(`Created:     ${entry.created}`);
        console.log(`Default:     ${workspace.default === entry.name ? 'yes' : 'no'}`);
        if (entry.description) console.log(`Description: ${entry.description}`);
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  ws
    .command('where [name]')
    .description('Print the absolute path of a vault (for shell use)')
    .action((name: string | undefined) => {
      try {
        const workspace = loadWorkspace();
        const target = name ?? workspace.default;
        if (!target) {
          printError('No default vault set and no name given.');
          process.exit(1);
        }
        const entry = findVault(workspace, target);
        if (!entry) {
          printError(`No vault named "${target}".`);
          process.exit(1);
        }
        console.log(entry.path);
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });
}
