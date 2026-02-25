import { Command } from 'commander';
import matter from 'gray-matter';
import { Vault } from '../vault.js';
import { getVaultPath } from '../config.js';
import { output, printTable, printError, printSuccess } from '../utils/output.js';
import { extractInlineTags } from '../utils/markdown.js';

export function registerTagsCommands(program: Command): void {
  const tags = program
    .command('tags')
    .description('Manage and query tags across the vault')
    .addHelpText('after', `
Examples:
  $ obs tags list path/to/note.md
  $ obs tags add path/to/note.md project
  $ obs tags remove path/to/note.md project
  $ obs tags all --sort name
  $ obs tags all --min-count 5 --json | jq '.[0:10]'`);

  tags
    .command('list <file>')
    .description('Show tags from frontmatter of a specific file')
    .action((file: string) => {
      try {
        const vaultPath = getVaultPath(program.opts().vault);
        const vault = new Vault(vaultPath);
        const jsonMode = program.opts().json;

        const parsed = vault.readFile(file);
        const fileTags = parseFrontmatterTags(parsed.frontmatter);

        if (jsonMode) {
          output(fileTags, { json: true });
          return;
        }

        if (fileTags.length === 0) {
          console.log('No tags found in frontmatter.');
          return;
        }

        for (const tag of fileTags) {
          console.log(tag);
        }
      } catch (err: unknown) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  tags
    .command('add <file> <tag>')
    .description('Add a tag to the frontmatter tags array')
    .action((file: string, tag: string) => {
      try {
        const vaultPath = getVaultPath(program.opts().vault);
        const vault = new Vault(vaultPath);

        const raw = vault.readFileRaw(file);
        const { data, content } = matter(raw);

        const existing = parseFrontmatterTags(data);
        if (existing.includes(tag)) {
          printError(`Tag "${tag}" already exists in ${file}.`);
          process.exitCode = 1;
          return;
        }

        // Ensure tags is an array
        if (!Array.isArray(data.tags)) {
          data.tags = existing.length > 0 ? [...existing] : [];
        }
        (data.tags as string[]).push(tag);

        const updated = matter.stringify(content, data);
        vault.writeFile(file, updated);
        printSuccess(`Added tag "${tag}" to ${file}.`);
      } catch (err: unknown) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  tags
    .command('remove <file> <tag>')
    .description('Remove a tag from the frontmatter tags array')
    .action((file: string, tag: string) => {
      try {
        const vaultPath = getVaultPath(program.opts().vault);
        const vault = new Vault(vaultPath);

        const raw = vault.readFileRaw(file);
        const { data, content } = matter(raw);

        const existing = parseFrontmatterTags(data);
        if (!existing.includes(tag)) {
          printError(`Tag "${tag}" not found in ${file}.`);
          process.exitCode = 1;
          return;
        }

        // Ensure tags is an array and filter out the tag
        data.tags = existing.filter((t) => t !== tag);

        // Remove tags key entirely if empty
        if ((data.tags as string[]).length === 0) {
          delete data.tags;
        }

        const updated = matter.stringify(content, data);
        vault.writeFile(file, updated);
        printSuccess(`Removed tag "${tag}" from ${file}.`);
      } catch (err: unknown) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  tags
    .command('all')
    .description('Scan all files for tags (frontmatter + inline) and show counts')
    .option('--sort <method>', 'Sort by "count" or "name"', 'count')
    .option('--min-count <n>', 'Minimum tag count to display', '1')
    .action(async (opts: { sort: string; minCount: string }) => {
      try {
        const vaultPath = getVaultPath(program.opts().vault);
        const vault = new Vault(vaultPath);
        const jsonMode = program.opts().json;
        const minCount = parseInt(opts.minCount, 10) || 1;

        const files = await vault.listFiles();
        const tagCounts = new Map<string, number>();

        for (const file of files) {
          let raw: string;
          try {
            raw = vault.readFileRaw(file);
          } catch {
            continue;
          }

          // Frontmatter tags
          try {
            const { data, content } = matter(raw);
            const fmTags = parseFrontmatterTags(data);
            for (const t of fmTags) {
              tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
            }

            // Inline tags (from body only, not frontmatter)
            const inlineTags = extractInlineTags(content);
            for (const t of inlineTags) {
              tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
            }
          } catch {
            // If frontmatter parsing fails, just scan inline
            const inlineTags = extractInlineTags(raw);
            for (const t of inlineTags) {
              tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
            }
          }
        }

        // Filter and sort
        let entries = Array.from(tagCounts.entries()).filter(
          ([, count]) => count >= minCount
        );

        if (opts.sort === 'name') {
          entries.sort((a, b) => a[0].localeCompare(b[0]));
        } else {
          // Default: sort by count descending
          entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        }

        if (jsonMode) {
          const data = entries.map(([tag, count]) => ({ tag, count }));
          output(data, { json: true });
          return;
        }

        if (entries.length === 0) {
          console.log('No tags found.');
          return;
        }

        printTable(
          ['Tag', 'Count'],
          entries.map(([tag, count]) => [tag, count])
        );
      } catch (err: unknown) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });
}

/**
 * Parse the `tags` field from frontmatter, handling both array and
 * comma-separated string formats.
 */
function parseFrontmatterTags(frontmatter: Record<string, unknown>): string[] {
  const raw = frontmatter.tags;
  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw.map(String).map((t) => t.trim()).filter(Boolean);
  }

  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }

  return [];
}
