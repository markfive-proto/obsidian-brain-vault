import { Command } from 'commander';
import { basename } from 'node:path';
import { Vault } from '../vault.js';
import { getVaultPath } from '../config.js';
import { output, printTable, printError } from '../utils/output.js';
import { extractWikilinks, extractMarkdownLinks, resolveWikilink } from '../utils/markdown.js';

function listLinksForFile(v: Vault, filePath: string, jsonMode: boolean): void {
  const raw = v.readFileRaw(filePath);
  const wikilinks = extractWikilinks(raw);
  const mdLinks = extractMarkdownLinks(raw);

  if (jsonMode) {
    output({ wikilinks, markdownLinks: mdLinks }, { json: true });
    return;
  }

  if (wikilinks.length === 0 && mdLinks.length === 0) {
    console.log('No links found.');
    return;
  }

  if (wikilinks.length > 0) {
    console.log('Wikilinks:');
    const rows = wikilinks.map(link => {
      const display = link.alias ?? link.target;
      const extra = link.heading ? `#${link.heading}` : link.blockRef ? `#^${link.blockRef}` : '';
      return [link.target + extra, display];
    });
    printTable(['Target', 'Display'], rows);
  }

  if (mdLinks.length > 0) {
    if (wikilinks.length > 0) console.log('');
    console.log('Markdown links:');
    printTable(['Text', 'URL'], mdLinks.map(link => [link.text, link.url]));
  }
}

export function registerLinksCommands(program: Command): void {
  const links = program
    .command('links')
    .description('Analyze links between notes');

  const listAction = async (filePath: string) => {
    const opts = program.opts();

    try {
      const vaultPath = getVaultPath(opts.vault);
      const v = new Vault(vaultPath);

      if (!v.isValid()) {
        printError(`Not a valid Obsidian vault: ${vaultPath}`);
        process.exit(1);
      }

      if (!v.fileExists(filePath)) {
        printError(`File not found: ${filePath}`);
        process.exit(1);
      }

      listLinksForFile(v, filePath, opts.json);
    } catch (err) {
      printError((err as Error).message);
      process.exit(1);
    }
  };

  links
    .command('list <file>')
    .description('Show all outgoing links from a file')
    .action(listAction);

  links
    .command('outgoing <file>')
    .description('Show all outgoing links from a file (alias for list)')
    .action(listAction);

  links
    .command('backlinks <file>')
    .description('Find all files that link to the given file')
    .action(async (targetPath: string) => {
      const opts = program.opts();
      const jsonMode = opts.json;

      try {
        const vaultPath = getVaultPath(opts.vault);
        const v = new Vault(vaultPath);

        if (!v.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        const allFiles = await v.listFiles();
        const targetBasename = basename(targetPath).replace(/\.md$/, '').toLowerCase();

        const backlinks: Array<{ source: string; linkText: string }> = [];

        for (const file of allFiles) {
          if (file === targetPath) continue;

          try {
            const raw = v.readFileRaw(file);
            const wikilinks = extractWikilinks(raw);

            for (const link of wikilinks) {
              const resolved = resolveWikilink(link.target, allFiles);
              if (resolved === targetPath) {
                backlinks.push({ source: file, linkText: link.target });
                continue;
              }

              // Fallback: case-insensitive basename comparison
              const linkBasename = link.target.toLowerCase().split('/').pop() ?? '';
              if (linkBasename === targetBasename) {
                backlinks.push({ source: file, linkText: link.target });
              }
            }
          } catch {
            // skip unreadable files
          }
        }

        // Deduplicate by source+linkText
        const seen = new Set<string>();
        const unique = backlinks.filter(bl => {
          const key = `${bl.source}::${bl.linkText}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        if (jsonMode) {
          output(unique, { json: true });
          return;
        }

        if (unique.length === 0) {
          console.log(`No backlinks found for: ${targetPath}`);
          return;
        }

        console.log(`Backlinks to ${targetPath}:`);
        printTable(['Source File', 'Link Text'], unique.map(bl => [bl.source, bl.linkText]));
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  links
    .command('broken')
    .description('Find all unresolved wikilinks across the vault')
    .option('--limit <n>', 'Limit number of results', parseInt)
    .action(async (cmdOpts: { limit?: number }) => {
      const opts = program.opts();
      const jsonMode = opts.json;

      try {
        const vaultPath = getVaultPath(opts.vault);
        const v = new Vault(vaultPath);

        if (!v.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        const allFiles = await v.listFiles();
        const broken: Array<{ file: string; target: string }> = [];

        for (const file of allFiles) {
          try {
            const raw = v.readFileRaw(file);
            const wikilinks = extractWikilinks(raw);

            for (const link of wikilinks) {
              if (!link.target) continue;
              const resolved = resolveWikilink(link.target, allFiles);
              if (resolved === null) {
                broken.push({ file, target: link.target });
              }
            }
          } catch {
            // skip unreadable files
          }
        }

        const limited = cmdOpts.limit ? broken.slice(0, cmdOpts.limit) : broken;

        if (jsonMode) {
          output(limited, { json: true });
          return;
        }

        if (limited.length === 0) {
          console.log('No broken links found.');
          return;
        }

        console.log(`Found ${broken.length} broken link(s)${cmdOpts.limit ? ` (showing ${limited.length})` : ''}:`);
        printTable(['File', 'Broken Target'], limited.map(bl => [bl.file, bl.target]));
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });
}
