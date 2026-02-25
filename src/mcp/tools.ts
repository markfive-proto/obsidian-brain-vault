import { z } from 'zod';
import { Vault } from '../vault.js';
import { extractWikilinks, extractMarkdownLinks, extractTasks, extractInlineTags, resolveWikilink } from '../utils/markdown.js';
import { updateFrontmatter, parseFrontmatter } from '../utils/frontmatter.js';
import matter from 'gray-matter';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerTools(server: McpServer, vault: Vault): void {
  server.tool(
    'obs_vault_info',
    'Get vault information: name, path, file count, enabled plugins, and stats',
    {},
    async () => {
      const stats = await vault.getStats();
      const corePlugins = vault.readObsidianConfig<Record<string, boolean>>('core-plugins.json');
      const communityPlugins = vault.readObsidianConfig<string[]>('community-plugins.json');

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            path: vault.path,
            stats,
            corePlugins: corePlugins ?? {},
            communityPlugins: communityPlugins ?? [],
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'obs_read_note',
    'Read a note from the vault. Returns frontmatter and body content.',
    { path: z.string().describe('Relative path to the note (e.g. "Notes/my-note.md")') },
    async ({ path }) => {
      const parsed = vault.readFile(path);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            path,
            frontmatter: parsed.frontmatter,
            body: parsed.body,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'obs_write_note',
    'Write content to an existing note (overwrites)',
    {
      path: z.string().describe('Relative path to the note'),
      content: z.string().describe('Full content to write'),
    },
    async ({ path, content }) => {
      vault.writeFile(path, content);
      return {
        content: [{ type: 'text' as const, text: `Written: ${path}` }],
      };
    },
  );

  server.tool(
    'obs_create_note',
    'Create a new note. Fails if the file already exists.',
    {
      path: z.string().describe('Relative path for the new note'),
      content: z.string().optional().describe('Initial content (default: empty)'),
    },
    async ({ path, content }) => {
      if (vault.fileExists(path)) {
        return {
          content: [{ type: 'text' as const, text: `Error: File already exists: ${path}` }],
          isError: true,
        };
      }
      vault.writeFile(path, content ?? '');
      return {
        content: [{ type: 'text' as const, text: `Created: ${path}` }],
      };
    },
  );

  server.tool(
    'obs_search',
    'Search vault content by text, path glob, or regex',
    {
      mode: z.enum(['content', 'path', 'regex']).describe('Search mode'),
      query: z.string().describe('Search query or pattern'),
      limit: z.number().optional().default(50).describe('Max results'),
    },
    async ({ mode, query, limit }) => {
      if (mode === 'path') {
        const pattern = query.includes('*') || query.includes('?')
          ? query
          : `**/*${query}*`;
        const files = await vault.listFiles(pattern);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(files.slice(0, limit), null, 2) }],
        };
      }

      const files = await vault.listFiles();
      const matches: Array<{ file: string; line: number; text: string }> = [];

      const regex = mode === 'regex' ? new RegExp(query, 'i') : null;

      for (const file of files) {
        if (matches.length >= limit) break;
        let raw: string;
        try { raw = vault.readFileRaw(file); } catch { continue; }
        const lines = raw.split('\n');

        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= limit) break;
          if (mode === 'content') {
            if (lines[i].toLowerCase().includes(query.toLowerCase())) {
              matches.push({ file, line: i + 1, text: lines[i] });
            }
          } else if (regex) {
            regex.lastIndex = 0;
            if (regex.test(lines[i])) {
              matches.push({ file, line: i + 1, text: lines[i] });
            }
          }
        }
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(matches, null, 2) }],
      };
    },
  );

  server.tool(
    'obs_list_files',
    'List files in the vault matching a glob pattern',
    {
      pattern: z.string().optional().default('**/*.md').describe('Glob pattern (default: **/*.md)'),
    },
    async ({ pattern }) => {
      const files = await vault.listFiles(pattern);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(files, null, 2) }],
      };
    },
  );

  server.tool(
    'obs_manage_tags',
    'List, add, or remove tags from a note\'s frontmatter',
    {
      action: z.enum(['list', 'add', 'remove']).describe('Action to perform'),
      path: z.string().describe('Relative path to the note'),
      tag: z.string().optional().describe('Tag to add or remove (required for add/remove)'),
    },
    async ({ action, path, tag }) => {
      const raw = vault.readFileRaw(path);
      const { data, content } = matter(raw);

      const existing = parseFmTags(data);

      if (action === 'list') {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(existing, null, 2) }],
        };
      }

      if (!tag) {
        return {
          content: [{ type: 'text' as const, text: 'Error: tag parameter required for add/remove' }],
          isError: true,
        };
      }

      if (action === 'add') {
        if (existing.includes(tag)) {
          return {
            content: [{ type: 'text' as const, text: `Tag "${tag}" already exists` }],
          };
        }
        if (!Array.isArray(data.tags)) data.tags = [...existing];
        (data.tags as string[]).push(tag);
      } else {
        if (!existing.includes(tag)) {
          return {
            content: [{ type: 'text' as const, text: `Tag "${tag}" not found` }],
            isError: true,
          };
        }
        data.tags = existing.filter(t => t !== tag);
        if ((data.tags as string[]).length === 0) delete data.tags;
      }

      vault.writeFile(path, matter.stringify(content, data));
      return {
        content: [{ type: 'text' as const, text: `${action === 'add' ? 'Added' : 'Removed'} tag "${tag}" in ${path}` }],
      };
    },
  );

  server.tool(
    'obs_manage_properties',
    'Read or set frontmatter properties on a note',
    {
      action: z.enum(['read', 'set']).describe('Action to perform'),
      path: z.string().describe('Relative path to the note'),
      key: z.string().optional().describe('Property key (omit to read all)'),
      value: z.string().optional().describe('Value to set (required for set action)'),
    },
    async ({ action, path, key, value }) => {
      if (action === 'read') {
        const parsed = vault.readFile(path);
        const result = key ? { [key]: parsed.frontmatter[key] ?? null } : parsed.frontmatter;
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      }

      if (!key || value === undefined) {
        return {
          content: [{ type: 'text' as const, text: 'Error: key and value required for set action' }],
          isError: true,
        };
      }

      const raw = vault.readFileRaw(path);
      const parsedValue = parsePropertyValue(value);
      const updated = updateFrontmatter(raw, { [key]: parsedValue });
      vault.writeFile(path, updated);

      return {
        content: [{ type: 'text' as const, text: `Set ${key} = ${JSON.stringify(parsedValue)} in ${path}` }],
      };
    },
  );

  server.tool(
    'obs_daily_note',
    'Create or read a daily note',
    {
      action: z.enum(['create', 'read']).describe('Create or read a daily note'),
      date: z.string().optional().describe('Date in YYYY-MM-DD format (default: today)'),
    },
    async ({ action, date }) => {
      const { format } = await import('date-fns');
      const { momentToDateFns } = await import('../utils/template.js');

      const dailyConfig = vault.readObsidianConfig<{ folder?: string; format?: string }>('daily-notes.json');
      const folder = dailyConfig?.folder ?? '';
      const dateFormat = momentToDateFns(dailyConfig?.format ?? 'YYYY-MM-DD');
      const dateObj = date ? new Date(date + 'T00:00:00') : new Date();
      const fileName = format(dateObj, dateFormat);
      const notePath = folder ? `${folder}/${fileName}.md` : `${fileName}.md`;

      if (action === 'read') {
        if (!vault.fileExists(notePath)) {
          return {
            content: [{ type: 'text' as const, text: `Daily note not found: ${notePath}` }],
            isError: true,
          };
        }
        const content = vault.readFileRaw(notePath);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ path: notePath, content }, null, 2) }],
        };
      }

      if (vault.fileExists(notePath)) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ path: notePath, status: 'exists' }, null, 2) }],
        };
      }

      const { mkdirSync, existsSync } = await import('node:fs');
      const { dirname } = await import('node:path');
      const fullDir = vault.resolvePath(dirname(notePath));
      if (!existsSync(fullDir)) mkdirSync(fullDir, { recursive: true });

      vault.writeFile(notePath, '');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ path: notePath, status: 'created' }, null, 2) }],
      };
    },
  );

  server.tool(
    'obs_list_links',
    'List outgoing links, backlinks, or broken links for a note',
    {
      action: z.enum(['outgoing', 'backlinks', 'broken']).describe('Type of link analysis'),
      path: z.string().optional().describe('Note path (required for outgoing/backlinks)'),
      limit: z.number().optional().default(50).describe('Max results'),
    },
    async ({ action, path, limit }) => {
      if (action === 'outgoing') {
        if (!path) return { content: [{ type: 'text' as const, text: 'Error: path required for outgoing links' }], isError: true };
        const raw = vault.readFileRaw(path);
        const wikilinks = extractWikilinks(raw);
        const mdLinks = extractMarkdownLinks(raw);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ wikilinks, markdownLinks: mdLinks }, null, 2) }],
        };
      }

      const allFiles = await vault.listFiles();

      if (action === 'backlinks') {
        if (!path) return { content: [{ type: 'text' as const, text: 'Error: path required for backlinks' }], isError: true };
        const targetBase = path.replace(/\.md$/, '').toLowerCase().split('/').pop() ?? '';
        const backlinks: Array<{ source: string; linkText: string }> = [];

        for (const file of allFiles) {
          if (file === path) continue;
          try {
            const raw = vault.readFileRaw(file);
            const wikilinks = extractWikilinks(raw);
            for (const link of wikilinks) {
              const resolved = resolveWikilink(link.target, allFiles);
              if (resolved === path || link.target.toLowerCase().split('/').pop() === targetBase) {
                backlinks.push({ source: file, linkText: link.target });
              }
            }
          } catch { continue; }
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(backlinks.slice(0, limit), null, 2) }],
        };
      }

      // broken links
      const broken: Array<{ file: string; target: string }> = [];
      for (const file of allFiles) {
        try {
          const raw = vault.readFileRaw(file);
          const wikilinks = extractWikilinks(raw);
          for (const link of wikilinks) {
            if (!link.target) continue;
            if (resolveWikilink(link.target, allFiles) === null) {
              broken.push({ file, target: link.target });
            }
          }
        } catch { continue; }
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(broken.slice(0, limit), null, 2) }],
      };
    },
  );
}

function parseFmTags(frontmatter: Record<string, unknown>): string[] {
  const raw = frontmatter.tags;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).map(t => t.trim()).filter(Boolean);
  if (typeof raw === 'string') return raw.split(',').map(t => t.trim()).filter(Boolean);
  return [];
}

function parsePropertyValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw !== '' && !isNaN(Number(raw))) return Number(raw);
  if (raw.includes(',')) return raw.split(',').map(s => s.trim());
  return raw;
}
