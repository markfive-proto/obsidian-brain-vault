import { Command } from 'commander';
import { Vault } from '../vault.js';
import { getVaultPath } from '../config.js';
import { output, printTable, printError, printSuccess } from '../utils/output.js';
import { dirname } from 'node:path';

export function registerBasesCommands(program: Command): void {
  const bases = program
    .command('bases')
    .description('Manage base files');

  bases
    .command('list')
    .description('List all base files')
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

        const files = await v.listFiles('**/*.base');

        if (jsonMode) {
          output(files, { json: true });
          return;
        }

        if (files.length === 0) {
          console.log('No base files found.');
          return;
        }

        const rows = files.map(f => [f]);
        printTable(['Base File'], rows);
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  bases
    .command('read <path>')
    .description('Read and display a base file')
    .action(async (filePath: string) => {
      const opts = program.opts();
      const jsonMode = opts.json;

      try {
        const vaultPath = getVaultPath(opts.vault);
        const v = new Vault(vaultPath);

        if (!v.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        if (!v.fileExists(filePath)) {
          printError(`Base file not found: ${filePath}`);
          process.exit(1);
        }

        const raw = v.readFileRaw(filePath);

        if (jsonMode) {
          try {
            output(JSON.parse(raw), { json: true });
          } catch {
            output(raw);
          }
          return;
        }

        console.log(raw);
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  bases
    .command('create <path>')
    .description('Create a new base file')
    .option('--source <folder>', 'Source folder for the base')
    .action(async (filePath: string, cmdOpts: { source?: string }) => {
      const opts = program.opts();

      try {
        const vaultPath = getVaultPath(opts.vault);
        const v = new Vault(vaultPath);

        if (!v.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        if (v.fileExists(filePath)) {
          printError(`Base file already exists: ${filePath}`);
          process.exit(1);
        }

        const source = cmdOpts.source ?? dirname(filePath);

        const data = {
          headings: [],
          rows: [],
          sources: [source],
        };

        v.writeFile(filePath, JSON.stringify(data, null, 2));
        printSuccess(`Base created: ${filePath}`);
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });
}
