import { Command } from 'commander';
import chalk from 'chalk';
import { Vault } from '../vault.js';
import { getVaultPath } from '../config.js';
import { output, printError } from '../utils/output.js';

interface ContentMatch {
  file: string;
  line: number;
  text: string;
}

export function registerSearchCommands(program: Command): void {
  const search = program
    .command('search')
    .description('Search vault content, filenames, or by regex')
    .addHelpText('after', `
Examples:
  $ obs search content "meeting notes"
  $ obs search content "TODO" --case-sensitive --limit 10
  $ obs search path "meeting"
  $ obs search regex "TODO|FIXME" --flags gi
  $ obs search content "project" --json | jq '[.[].file] | unique'`);

  search
    .command('content <query>')
    .description('Full-text search across all markdown files')
    .option('--case-sensitive', 'Enable case-sensitive matching', false)
    .option('--limit <n>', 'Maximum number of results', '50')
    .action(async (query: string, opts: { caseSensitive: boolean; limit: string }) => {
      try {
        const vaultPath = getVaultPath(program.opts().vault);
        const vault = new Vault(vaultPath);
        const jsonMode = program.opts().json;
        const limit = parseInt(opts.limit, 10) || 50;

        const files = await vault.listFiles();
        const matches: ContentMatch[] = [];

        for (const file of files) {
          if (matches.length >= limit) break;
          let raw: string;
          try {
            raw = vault.readFileRaw(file);
          } catch {
            continue;
          }
          const lines = raw.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= limit) break;
            const lineText = lines[i];
            const haystack = opts.caseSensitive ? lineText : lineText.toLowerCase();
            const needle = opts.caseSensitive ? query : query.toLowerCase();
            if (haystack.includes(needle)) {
              matches.push({ file, line: i + 1, text: lineText });
            }
          }
        }

        if (jsonMode) {
          output(matches, { json: true });
          return;
        }

        if (matches.length === 0) {
          console.log('No matches found.');
          return;
        }

        for (const m of matches) {
          const highlighted = highlightMatch(m.text, query, opts.caseSensitive);
          console.log(
            `${chalk.cyan(m.file)}${chalk.dim(':' + m.line)} ${highlighted}`
          );
        }
        console.log(chalk.dim(`\n${matches.length} match${matches.length === 1 ? '' : 'es'} found.`));
      } catch (err: unknown) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  search
    .command('path <query>')
    .description('Glob-based filename search')
    .action(async (query: string) => {
      try {
        const vaultPath = getVaultPath(program.opts().vault);
        const vault = new Vault(vaultPath);
        const jsonMode = program.opts().json;

        // Convert query into a glob pattern if it doesn't already have wildcards
        const pattern = query.includes('*') || query.includes('?')
          ? query
          : `**/*${query}*`;

        const files = await vault.listFiles(pattern);

        if (jsonMode) {
          output(files, { json: true });
          return;
        }

        if (files.length === 0) {
          console.log('No matching files found.');
          return;
        }

        for (const f of files) {
          console.log(f);
        }
        console.log(chalk.dim(`\n${files.length} file${files.length === 1 ? '' : 's'} found.`));
      } catch (err: unknown) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  search
    .command('regex <pattern>')
    .description('Regex search across all markdown files')
    .option('--flags <flags>', 'Regex flags (e.g. "gi")', '')
    .action(async (pattern: string, opts: { flags: string }) => {
      try {
        const vaultPath = getVaultPath(program.opts().vault);
        const vault = new Vault(vaultPath);
        const jsonMode = program.opts().json;

        let regex: RegExp;
        try {
          regex = new RegExp(pattern, opts.flags || 'i');
        } catch (e: unknown) {
          printError(`Invalid regex: ${(e as Error).message}`);
          process.exitCode = 1;
          return;
        }

        const files = await vault.listFiles();
        const matches: ContentMatch[] = [];

        for (const file of files) {
          let raw: string;
          try {
            raw = vault.readFileRaw(file);
          } catch {
            continue;
          }
          const lines = raw.split('\n');
          for (let i = 0; i < lines.length; i++) {
            // Reset lastIndex for global regexes
            regex.lastIndex = 0;
            if (regex.test(lines[i])) {
              matches.push({ file, line: i + 1, text: lines[i] });
            }
          }
        }

        if (jsonMode) {
          output(matches, { json: true });
          return;
        }

        if (matches.length === 0) {
          console.log('No matches found.');
          return;
        }

        for (const m of matches) {
          // Highlight regex matches
          regex.lastIndex = 0;
          const highlighted = m.text.replace(regex, (match) => chalk.yellow.bold(match));
          console.log(
            `${chalk.cyan(m.file)}${chalk.dim(':' + m.line)} ${highlighted}`
          );
        }
        console.log(chalk.dim(`\n${matches.length} match${matches.length === 1 ? '' : 'es'} found.`));
      } catch (err: unknown) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });
}

function highlightMatch(text: string, query: string, caseSensitive: boolean): string {
  const flags = caseSensitive ? 'g' : 'gi';
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, flags);
  return text.replace(regex, (match) => chalk.yellow.bold(match));
}
