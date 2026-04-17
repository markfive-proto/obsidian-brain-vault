import { z } from 'zod';
import { subDays, subWeeks, subMonths, subYears } from 'date-fns';
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Vault } from '../vault.js';
import { extractWikilinks, extractMarkdownLinks, extractTasks, extractInlineTags, resolveWikilink } from '../utils/markdown.js';
import { updateFrontmatter, parseFrontmatter } from '../utils/frontmatter.js';
import matter from 'gray-matter';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const KB_DIRS: Record<string, string[]> = {
  raw: ['articles', 'papers', 'repos', 'transcripts', 'images', 'datasets'],
  compiled: ['concepts', 'people', 'orgs'],
  outputs: ['answers', 'reports', 'briefs', 'slides', 'charts', 'graphs', 'handbooks', 'lint', 'eval', 'autohunt', 'verify'],
};

function countMd(dir: string): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) n += countMd(full);
    else if (entry.name.endsWith('.md')) n += 1;
  }
  return n;
}

function listMd(dir: string, root: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMd(full, root));
    else if (entry.name.endsWith('.md')) out.push(full.slice(root.length + 1));
  }
  return out;
}

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

  server.tool(
    'obs_list_files_filtered',
    'List vault files with date-range and frontmatter filtering',
    {
      since: z.string().optional().describe('Duration filter, e.g. "7d", "2w", "1m", "1y"'),
      before: z.string().optional().describe('Date filter in YYYY-MM-DD format'),
      where: z.array(z.string()).optional().describe('Frontmatter filters as ["key=value", ...]'),
      folder: z.string().optional().describe('Filter by folder path'),
      sort: z.enum(['name', 'modified', 'size']).optional().default('name').describe('Sort field'),
      limit: z.number().optional().default(50).describe('Max results'),
    },
    async ({ since, before, where, folder, sort, limit }) => {
      let files = await vault.listFiles('**/*');

      if (folder) {
        const f = folder.replace(/\/$/, '');
        files = files.filter(file => file.startsWith(f + '/') || file === f);
      }

      if (since) {
        const match = since.match(/^(\d+)([dwmy])$/i);
        if (!match) {
          return { content: [{ type: 'text' as const, text: 'Error: Invalid since format. Use e.g. 7d, 2w, 1m' }], isError: true };
        }
        const amount = parseInt(match[1], 10);
        const unit = match[2].toLowerCase();
        const now = new Date();
        const sinceDate = unit === 'd' ? subDays(now, amount) : unit === 'w' ? subWeeks(now, amount) : unit === 'm' ? subMonths(now, amount) : subYears(now, amount);
        files = files.filter(f => { try { return vault.fileStat(f).mtime >= sinceDate; } catch { return false; } });
      }

      if (before) {
        const beforeDate = new Date(before + 'T23:59:59');
        if (isNaN(beforeDate.getTime())) {
          return { content: [{ type: 'text' as const, text: 'Error: Invalid date format. Use YYYY-MM-DD' }], isError: true };
        }
        files = files.filter(f => { try { return vault.fileStat(f).mtime <= beforeDate; } catch { return false; } });
      }

      if (where && where.length > 0) {
        const filters = where.map((w: string) => {
          const eqIdx = w.indexOf('=');
          if (eqIdx === -1) return null;
          return { key: w.slice(0, eqIdx), value: w.slice(eqIdx + 1) };
        }).filter(Boolean) as Array<{ key: string; value: string }>;

        files = files.filter(f => {
          if (!f.endsWith('.md')) return false;
          try {
            const parsed = vault.readFile(f);
            return filters.every(({ key, value }) => {
              const fmVal = parsed.frontmatter[key];
              if (fmVal === undefined || fmVal === null) return false;
              if (Array.isArray(fmVal)) return fmVal.map(String).includes(value);
              return String(fmVal) === value;
            });
          } catch { return false; }
        });
      }

      if (sort === 'modified') {
        files.sort((a, b) => { try { return vault.fileStat(b).mtime.getTime() - vault.fileStat(a).mtime.getTime(); } catch { return 0; } });
      } else if (sort === 'size') {
        files.sort((a, b) => { try { return vault.fileStat(b).size - vault.fileStat(a).size; } catch { return 0; } });
      } else {
        files.sort((a, b) => a.localeCompare(b));
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(files.slice(0, limit), null, 2) }],
      };
    },
  );

  server.tool(
    'obs_links_path',
    'Find the shortest link path between two notes via BFS',
    {
      from: z.string().describe('Starting note path or name'),
      to: z.string().describe('Target note path or name'),
    },
    async ({ from, to }) => {
      const allFiles = await vault.listFiles();

      const resolveNote = (input: string): string | null => {
        if (allFiles.includes(input)) return input;
        const withMd = input.endsWith('.md') ? input : input + '.md';
        if (allFiles.includes(withMd)) return withMd;
        return resolveWikilink(input.replace(/\.md$/, ''), allFiles);
      };

      const startFile = resolveNote(from);
      const endFile = resolveNote(to);

      if (!startFile) return { content: [{ type: 'text' as const, text: `Error: Note not found: ${from}` }], isError: true };
      if (!endFile) return { content: [{ type: 'text' as const, text: `Error: Note not found: ${to}` }], isError: true };

      const adj = new Map<string, string[]>();
      for (const file of allFiles) {
        try {
          const raw = vault.readFileRaw(file);
          const wikilinks = extractWikilinks(raw);
          const neighbors: string[] = [];
          for (const link of wikilinks) {
            const resolved = resolveWikilink(link.target, allFiles);
            if (resolved && resolved !== file) neighbors.push(resolved);
          }
          adj.set(file, neighbors);
        } catch { /* skip */ }
      }

      const queue: string[][] = [[startFile]];
      const visited = new Set<string>([startFile]);
      let foundPath: string[] | null = null;

      while (queue.length > 0) {
        const path = queue.shift()!;
        const current = path[path.length - 1];
        if (current === endFile) { foundPath = path; break; }
        for (const neighbor of (adj.get(current) ?? [])) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push([...path, neighbor]);
          }
        }
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ from: startFile, to: endFile, path: foundPath, hops: foundPath ? foundPath.length - 1 : null }, null, 2) }],
      };
    },
  );

  server.tool(
    'obs_links_orphans',
    'Find notes with zero incoming backlinks',
    {
      limit: z.number().optional().default(50).describe('Max results'),
    },
    async ({ limit }) => {
      const allFiles = await vault.listFiles();
      const linkedTo = new Set<string>();

      for (const file of allFiles) {
        try {
          const raw = vault.readFileRaw(file);
          for (const link of extractWikilinks(raw)) {
            const resolved = resolveWikilink(link.target, allFiles);
            if (resolved) linkedTo.add(resolved);
          }
        } catch { /* skip */ }
      }

      const orphans = allFiles.filter(f => !linkedTo.has(f)).slice(0, limit);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(orphans, null, 2) }],
      };
    },
  );

  server.tool(
    'obs_vault_wordcount',
    'Get word counts for vault files',
    {
      file: z.string().optional().describe('Single file path (omit for vault-wide)'),
      top: z.number().optional().describe('Return only top N files by word count'),
    },
    async ({ file, top }) => {
      const countWords = (text: string): number => {
        const body = text.replace(/^---[\s\S]*?---\n?/, '');
        const words = body.match(/\S+/g);
        return words ? words.length : 0;
      };

      if (file) {
        if (!vault.fileExists(file)) {
          return { content: [{ type: 'text' as const, text: `Error: File not found: ${file}` }], isError: true };
        }
        const count = countWords(vault.readFileRaw(file));
        return { content: [{ type: 'text' as const, text: JSON.stringify({ file, words: count }, null, 2) }] };
      }

      const mdFiles = await vault.listFiles('**/*.md');
      const fileCounts: Array<{ file: string; words: number }> = [];
      let totalWords = 0;

      for (const f of mdFiles) {
        try {
          const count = countWords(vault.readFileRaw(f));
          fileCounts.push({ file: f, words: count });
          totalWords += count;
        } catch { /* skip */ }
      }

      fileCounts.sort((a, b) => b.words - a.words);
      const limited = top ? fileCounts.slice(0, top) : fileCounts;

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ totalWords, fileCount: fileCounts.length, files: limited }, null, 2) }],
      };
    },
  );

  registerKbTools(server, vault);
}

function registerKbTools(server: McpServer, vault: Vault): void {
  server.tool(
    'obs_kb_init',
    'Scaffold a Karpathy-style knowledge base in the vault: raw/, compiled/, outputs/ with starter files.',
    {},
    async () => {
      const root = vault.path;
      const created: string[] = [];
      for (const [top, subs] of Object.entries(KB_DIRS)) {
        const topFull = join(root, top);
        if (!existsSync(topFull)) { mkdirSync(topFull, { recursive: true }); created.push(top); }
        for (const s of subs) {
          const full = join(topFull, s);
          if (!existsSync(full)) { mkdirSync(full, { recursive: true }); created.push(join(top, s)); }
        }
      }
      const scaffolds: Array<[string, string]> = [
        ['raw/INGEST-LOG.md', '# Ingest Log\n\nAppend-only log. One line per ingest.\n\n'],
        ['compiled/00-INDEX.md', '---\ntitle: Knowledge Base Index\ntype: moc\ntags: [kb, index]\n---\n\n# Knowledge Base Index\n\nRun `obs kb compile` to populate.\n'],
        ['compiled/COMPILE-LOG.md', '# Compile Log\n\nAppend-only. One line per run.\n\n'],
      ];
      for (const [rel, content] of scaffolds) {
        const full = join(root, rel);
        if (!existsSync(full)) { writeFileSync(full, content, 'utf-8'); created.push(rel); }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ root, created }, null, 2) }],
      };
    },
  );

  server.tool(
    'obs_kb_stats',
    'Summary counts + health for the KB: raw sources, concept pages, dangling wikilinks.',
    {},
    async () => {
      const root = vault.path;
      const stats = {
        raw: countMd(join(root, 'raw')),
        concepts: countMd(join(root, 'compiled', 'concepts')),
        people: countMd(join(root, 'compiled', 'people')),
        orgs: countMd(join(root, 'compiled', 'orgs')),
        outputs: countMd(join(root, 'outputs')),
        scaffolded: existsSync(join(root, 'compiled', '00-INDEX.md')),
      };

      const allFiles = await vault.listFiles();
      const basenames = new Set<string>();
      for (const f of allFiles) {
        const base = f.split('/').pop()?.replace(/\.md$/, '') ?? '';
        if (base) basenames.add(base);
      }
      let dangling = 0;
      let totalLinks = 0;
      for (const f of allFiles) {
        if (!f.startsWith('compiled/') && !f.startsWith('raw/')) continue;
        try {
          const body = vault.readFileRaw(f);
          for (const link of extractWikilinks(body)) {
            totalLinks += 1;
            if (!basenames.has(link.target)) dangling += 1;
          }
        } catch { /* ignore */ }
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ ...stats, totalWikilinks: totalLinks, danglingWikilinks: dangling }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'obs_kb_list_raw',
    'List raw source files ingested into the KB.',
    {},
    async () => {
      const files = listMd(join(vault.path, 'raw'), vault.path);
      return { content: [{ type: 'text' as const, text: JSON.stringify(files, null, 2) }] };
    },
  );

  server.tool(
    'obs_kb_list_concepts',
    'List compiled concept pages.',
    {},
    async () => {
      const files = listMd(join(vault.path, 'compiled', 'concepts'), vault.path);
      return { content: [{ type: 'text' as const, text: JSON.stringify(files, null, 2) }] };
    },
  );

  server.tool(
    'obs_kb_list_outputs',
    'List generated outputs (answers, slides, charts, lint reports).',
    {},
    async () => {
      const files = listMd(join(vault.path, 'outputs'), vault.path);
      return { content: [{ type: 'text' as const, text: JSON.stringify(files, null, 2) }] };
    },
  );

  server.tool(
    'obs_kb_append_ingest_log',
    'Append a line to raw/INGEST-LOG.md. Used by ingest skills/tools after writing a raw file.',
    {
      type: z.enum(['article', 'paper', 'repo', 'transcript', 'image', 'dataset']),
      path: z.string().describe('Relative path of the raw file just written'),
      title: z.string().describe('Short title for the log line'),
    },
    async ({ type, path, title }) => {
      const log = join(vault.path, 'raw', 'INGEST-LOG.md');
      if (!existsSync(log)) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${log} does not exist. Run obs_kb_init first.` }],
          isError: true,
        };
      }
      const line = `- ${new Date().toISOString().replace('T', ' ').slice(0, 19)}  ${type}  ${path}  "${title.replace(/"/g, '\\"')}"\n`;
      const current = require('node:fs').readFileSync(log, 'utf-8');
      writeFileSync(log, current + line, 'utf-8');
      return { content: [{ type: 'text' as const, text: `Appended: ${line.trim()}` }] };
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
