import { Command } from 'commander';
import matter from 'gray-matter';
import { Vault } from '../vault.js';
import { getVaultPath } from '../config.js';
import { output, printError, printSuccess } from '../utils/output.js';

function stripHtmlTags(html: string): string {
  // Remove script and style blocks entirely
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');

  // Replace <br>, <p>, <div>, <li>, heading tags with newlines
  text = text.replace(/<\/?(br|p|div|li|h[1-6])[^>]*>/gi, '\n');

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');

  // Collapse multiple blank lines
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

function deriveFilenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Use the last path segment, or the hostname
    const segments = parsed.pathname.split('/').filter(Boolean);
    let name = segments.length > 0 ? segments[segments.length - 1] : parsed.hostname;

    // Remove file extension if present
    name = name.replace(/\.[^.]+$/, '');

    // Clean up the name
    name = name.replace(/[^a-zA-Z0-9_-]/g, '-');

    return name || 'imported-page';
  } catch {
    return 'imported-page';
  }
}

export function registerImportCommands(program: Command): void {
  const importCmd = program
    .command('import')
    .description('Import content into the vault');

  importCmd
    .command('url <url>')
    .description('Import a URL as a markdown note')
    .option('--name <filename>', 'Name for the imported note (without .md extension)')
    .action(async (url: string, opts) => {
      const programOpts = program.opts();

      try {
        const vaultPath = getVaultPath(programOpts.vault);
        const vault = new Vault(vaultPath);

        if (!vault.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          printError(`Unsupported protocol: ${parsed.protocol}. Only http and https are allowed.`);
          process.exit(1);
        }

        const response = await fetch(url);

        if (!response.ok) {
          printError(`Failed to fetch URL: ${response.status} ${response.statusText}`);
          process.exit(1);
        }

        const html = await response.text();
        const content = stripHtmlTags(html);

        const filename = opts.name || deriveFilenameFromUrl(url);
        const filePath = `${filename}.md`;

        const note = matter.stringify('\n' + content + '\n', {
          source: url,
          imported: new Date().toISOString(),
        });

        vault.writeFile(filePath, note);

        if (programOpts.json) {
          output({ path: filePath, source: url, status: 'imported' }, { json: true });
        } else {
          printSuccess(`Imported ${url} as ${filePath}`);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });
}
