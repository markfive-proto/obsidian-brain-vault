import { Command } from 'commander';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Vault } from '../vault.js';
import { getVaultPath } from '../config.js';
import { output, printTable, printError, printSuccess, printWarning } from '../utils/output.js';

interface AppearanceConfig {
  cssTheme?: string;
  [key: string]: unknown;
}

export function registerThemesCommands(program: Command): void {
  const themes = program
    .command('themes')
    .description('Manage vault themes');

  themes
    .command('list')
    .description('List installed themes')
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

        const themesDir = join(vault.path, '.obsidian', 'themes');
        if (!existsSync(themesDir)) {
          if (jsonMode) {
            output([], { json: true });
          } else {
            console.log('No themes installed.');
          }
          return;
        }

        const entries = readdirSync(themesDir, { withFileTypes: true });
        const themeNames: string[] = [];

        for (const entry of entries) {
          if (entry.isFile() && entry.name.endsWith('.css')) {
            themeNames.push(entry.name.replace(/\.css$/, ''));
          }
        }

        // Read current active theme
        const appearance = vault.readObsidianConfig<AppearanceConfig>('appearance.json');
        const activeTheme = appearance?.cssTheme ?? '';

        if (jsonMode) {
          output(themeNames.map(name => ({
            name,
            active: name === activeTheme,
          })), { json: true });
        } else {
          if (themeNames.length === 0) {
            console.log('No themes installed.');
          } else {
            const rows = themeNames.map(name => [
              name,
              name === activeTheme ? 'active' : '',
            ]);
            printTable(['Theme', 'Status'], rows);
          }
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  themes
    .command('apply <name>')
    .description('Apply a theme by name')
    .action((name: string) => {
      const opts = program.opts();

      try {
        const vaultPath = getVaultPath(opts.vault);
        const vault = new Vault(vaultPath);

        if (!vault.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        // Verify theme CSS file exists
        const themePath = join(vault.path, '.obsidian', 'themes', `${name}.css`);
        if (!existsSync(themePath)) {
          printError(`Theme not found: ${name}`);
          printWarning('Use "obs themes list" to see available themes.');
          process.exit(1);
        }

        // Read existing appearance.json or create new one
        const appearance = vault.readObsidianConfig<AppearanceConfig>('appearance.json') ?? {};
        appearance.cssTheme = name;
        vault.writeObsidianConfig('appearance.json', appearance);

        printSuccess(`Applied theme '${name}'.`);
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });
}
