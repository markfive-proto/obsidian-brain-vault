import { Command } from 'commander';
import { Vault } from '../vault.js';
import { getVaultPath } from '../config.js';
import { output, printTable, printError, printSuccess } from '../utils/output.js';
import { updateFrontmatter } from '../utils/frontmatter.js';

function parseValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw !== '' && !isNaN(Number(raw))) return Number(raw);
  if (raw.includes(',')) return raw.split(',').map(s => s.trim());
  return raw;
}

export function registerPropertiesCommands(program: Command): void {
  const properties = program
    .command('properties')
    .description('Read and write frontmatter properties');

  properties
    .command('read <file> [key]')
    .description('Read frontmatter properties (all or a specific key)')
    .action((file: string, key?: string) => {
      const opts = program.opts();
      const jsonMode = opts.json;

      try {
        const vaultPath = getVaultPath(opts.vault);
        const v = new Vault(vaultPath);

        if (!v.fileExists(file)) {
          printError(`File not found: ${file}`);
          process.exit(1);
        }

        const parsed = v.readFile(file);
        const fm = parsed.frontmatter;

        if (key) {
          const value = fm[key] ?? null;
          if (jsonMode) {
            output({ [key]: value }, { json: true });
          } else if (value === null) {
            console.log(`${key}: (not set)`);
          } else {
            const display = typeof value === 'object' ? JSON.stringify(value) : String(value);
            console.log(`${key}: ${display}`);
          }
        } else {
          if (jsonMode) {
            output(fm, { json: true });
          } else {
            const entries = Object.entries(fm);
            if (entries.length === 0) {
              console.log('No frontmatter properties.');
            } else {
              const rows = entries.map(([k, val]) => {
                const display = typeof val === 'object' ? JSON.stringify(val) : String(val);
                return [k, display];
              });
              printTable(['Key', 'Value'], rows);
            }
          }
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  function setProperty(file: string, key: string, value: string): void {
    const opts = program.opts();

    try {
      const vaultPath = getVaultPath(opts.vault);
      const v = new Vault(vaultPath);

      if (!v.fileExists(file)) {
        printError(`File not found: ${file}`);
        process.exit(1);
      }

      const raw = v.readFileRaw(file);
      const parsed = parseValue(value);
      const updated = updateFrontmatter(raw, { [key]: parsed });
      v.writeFile(file, updated);

      printSuccess(`Set ${key} = ${JSON.stringify(parsed)} in ${file}`);
    } catch (err) {
      printError((err as Error).message);
      process.exit(1);
    }
  }

  properties
    .command('set <file> <key> <value>')
    .description('Set a frontmatter property')
    .action(setProperty);

  properties
    .command('update <file> <key> <value>')
    .description('Update a frontmatter property (alias for set)')
    .action(setProperty);
}
