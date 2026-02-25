import { Command } from 'commander';
import { Vault } from '../vault.js';
import { getVaultPath } from '../config.js';
import { output, printTable, printError, printSuccess } from '../utils/output.js';

interface BookmarkItem {
  type: string;
  ctime: number;
  path: string;
}

interface BookmarksConfig {
  items: BookmarkItem[];
}

export function registerBookmarksCommands(program: Command): void {
  const bookmarks = program
    .command('bookmarks')
    .description('Manage vault bookmarks');

  bookmarks
    .command('list')
    .description('List all bookmarks')
    .action(async () => {
      const opts = program.opts();
      const jsonMode = opts.json;

      try {
        const vaultPath = getVaultPath(opts.vault);
        const v = new Vault(vaultPath);

        if (!v.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        const config = v.readObsidianConfig<BookmarksConfig>('bookmarks.json');
        const items = config?.items ?? [];

        if (jsonMode) {
          output(items, { json: true });
          return;
        }

        if (items.length === 0) {
          console.log('No bookmarks found.');
          return;
        }

        const rows = items.map(item => [
          item.type,
          item.path,
          new Date(item.ctime).toLocaleString(),
        ]);

        printTable(['Type', 'Path', 'Created'], rows);
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  bookmarks
    .command('add <path>')
    .description('Add a file bookmark')
    .action(async (filePath: string) => {
      const opts = program.opts();

      try {
        const vaultPath = getVaultPath(opts.vault);
        const v = new Vault(vaultPath);

        if (!v.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        const config = v.readObsidianConfig<BookmarksConfig>('bookmarks.json') ?? { items: [] };

        const existing = config.items.find(item => item.path === filePath);
        if (existing) {
          printError(`Bookmark already exists: ${filePath}`);
          process.exit(1);
        }

        config.items.push({
          type: 'file',
          ctime: Date.now(),
          path: filePath,
        });

        v.writeObsidianConfig('bookmarks.json', config);
        printSuccess(`Bookmark added: ${filePath}`);
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  bookmarks
    .command('remove <path>')
    .description('Remove a file bookmark')
    .action(async (filePath: string) => {
      const opts = program.opts();

      try {
        const vaultPath = getVaultPath(opts.vault);
        const v = new Vault(vaultPath);

        if (!v.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        const config = v.readObsidianConfig<BookmarksConfig>('bookmarks.json') ?? { items: [] };
        const originalLength = config.items.length;

        config.items = config.items.filter(item => item.path !== filePath);

        if (config.items.length === originalLength) {
          printError(`Bookmark not found: ${filePath}`);
          process.exit(1);
        }

        v.writeObsidianConfig('bookmarks.json', config);
        printSuccess(`Bookmark removed: ${filePath}`);
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });
}
