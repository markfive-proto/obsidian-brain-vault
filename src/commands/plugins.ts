import { Command } from 'commander';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Vault } from '../vault.js';
import { getVaultPath } from '../config.js';
import { output, printTable, printError, printSuccess, printWarning } from '../utils/output.js';

interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description?: string;
}

function getPluginFolders(vault: Vault): string[] {
  const pluginsDir = join(vault.path, '.obsidian', 'plugins');
  if (!existsSync(pluginsDir)) return [];
  try {
    return readdirSync(pluginsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch {
    return [];
  }
}

function readManifest(vault: Vault, folderName: string): PluginManifest | null {
  const manifestPath = join(vault.path, '.obsidian', 'plugins', folderName, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    return null;
  }
}

export function registerPluginsCommands(program: Command): void {
  const plugins = program
    .command('plugins')
    .description('Manage vault plugins');

  plugins
    .command('list')
    .description('List core and community plugins')
    .option('--enabled', 'Show only enabled plugins')
    .option('--disabled', 'Show only disabled plugins')
    .action((cmdOpts) => {
      const opts = program.opts();
      const jsonMode = opts.json;

      try {
        const vaultPath = getVaultPath(opts.vault);
        const vault = new Vault(vaultPath);

        if (!vault.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        const showEnabled = cmdOpts.enabled as boolean | undefined;
        const showDisabled = cmdOpts.disabled as boolean | undefined;
        const showAll = !showEnabled && !showDisabled;

        // Core plugins — can be string[] or Record<string, boolean>
        const coreRaw = vault.readObsidianConfig<string[] | Record<string, boolean>>('core-plugins.json');
        const coreRows: [string, string, string][] = [];
        if (coreRaw) {
          const entries: [string, boolean][] = Array.isArray(coreRaw)
            ? coreRaw.map(id => [id, true])
            : Object.entries(coreRaw);
          for (const [id, enabled] of entries) {
            const status = enabled ? 'enabled' : 'disabled';
            if (showAll || (showEnabled && enabled) || (showDisabled && !enabled)) {
              coreRows.push([id, 'core', status]);
            }
          }
        }

        // Community plugins
        const enabledCommunity = vault.readObsidianConfig<string[]>('community-plugins.json') ?? [];
        const enabledSet = new Set(enabledCommunity);
        const allFolders = getPluginFolders(vault);

        const communityRows: [string, string, string][] = [];

        if (showAll || showEnabled) {
          for (const name of enabledCommunity) {
            communityRows.push([name, 'community', 'enabled']);
          }
        }

        if (showAll || showDisabled) {
          for (const folder of allFolders) {
            if (!enabledSet.has(folder)) {
              communityRows.push([folder, 'community', 'disabled']);
            }
          }
        }

        const allRows = [...coreRows, ...communityRows];

        if (jsonMode) {
          output(allRows.map(([name, type, status]) => ({ name, type, status })), { json: true });
        } else {
          if (allRows.length === 0) {
            console.log('No plugins found.');
          } else {
            printTable(['Name', 'Type', 'Status'], allRows);
          }
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  plugins
    .command('versions')
    .description('Show installed community plugin versions')
    .action(() => {
      const opts = program.opts();
      const jsonMode = opts.json;

      try {
        const vaultPath = getVaultPath(opts.vault);
        const vault = new Vault(vaultPath);

        if (!vault.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        const folders = getPluginFolders(vault);
        const rows: [string, string, string, string][] = [];

        for (const folder of folders) {
          const manifest = readManifest(vault, folder);
          if (manifest) {
            rows.push([manifest.id, manifest.name, manifest.version, manifest.author]);
          } else {
            rows.push([folder, '(unknown)', '(unknown)', '(unknown)']);
          }
        }

        if (jsonMode) {
          output(rows.map(([id, name, version, author]) => ({ id, name, version, author })), { json: true });
        } else {
          if (rows.length === 0) {
            console.log('No community plugins installed.');
          } else {
            printTable(['ID', 'Name', 'Version', 'Author'], rows);
          }
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  plugins
    .command('enable <name>')
    .description('Enable a community plugin')
    .action((name: string) => {
      const opts = program.opts();

      try {
        const vaultPath = getVaultPath(opts.vault);
        const vault = new Vault(vaultPath);

        if (!vault.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        if (name.includes('/') || name.includes('\\') || name.includes('..')) {
          printError('Invalid plugin name.');
          process.exit(1);
        }

        const pluginDir = join(vault.path, '.obsidian', 'plugins', name);
        if (!existsSync(pluginDir)) {
          printError(`Plugin folder not found: ${name}`);
          process.exit(1);
        }

        const enabled = vault.readObsidianConfig<string[]>('community-plugins.json') ?? [];

        if (enabled.includes(name)) {
          printWarning(`Plugin '${name}' is already enabled.`);
          return;
        }

        enabled.push(name);
        vault.writeObsidianConfig('community-plugins.json', enabled);

        printSuccess(`Enabled plugin '${name}'.`);
        printWarning('Restart Obsidian for changes to take effect.');
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  plugins
    .command('disable <name>')
    .description('Disable a community plugin')
    .action((name: string) => {
      const opts = program.opts();

      try {
        const vaultPath = getVaultPath(opts.vault);
        const vault = new Vault(vaultPath);

        if (!vault.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        const enabled = vault.readObsidianConfig<string[]>('community-plugins.json') ?? [];
        const index = enabled.indexOf(name);

        if (index === -1) {
          printWarning(`Plugin '${name}' is not currently enabled.`);
          return;
        }

        enabled.splice(index, 1);
        vault.writeObsidianConfig('community-plugins.json', enabled);

        printSuccess(`Disabled plugin '${name}'.`);
        printWarning('Restart Obsidian for changes to take effect.');
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });
}
