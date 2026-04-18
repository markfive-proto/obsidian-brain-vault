import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { ingestLogPath, rawDir } from './paths.js';

export type IngestSourceType = 'article' | 'paper' | 'repo' | 'transcript' | 'image' | 'dataset';

export interface IngestResult {
  type: IngestSourceType;
  path: string;          // relative to vault root
  absolutePath: string;
  title: string;
  wordCount: number;
  duplicate?: boolean;   // true if file already existed
}

/**
 * Heuristically classify a source string. Explicit `--type` override takes
 * priority in the CLI layer; this is the fallback.
 */
export function detectSourceType(source: string): IngestSourceType {
  const s = source.trim();
  if (/^https?:\/\/github\.com\/[^\/]+\/[^\/?#]+/i.test(s)) return 'repo';
  if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(s)) return 'transcript';
  if (/^https?:\/\/(arxiv\.org|.*\.pdf(\?.*)?$)/i.test(s)) return 'paper';
  if (/\.pdf$/i.test(s)) return 'paper';
  if (/^https?:\/\//i.test(s)) return 'article';
  if (/\.(png|jpe?g|webp|gif)$/i.test(s)) return 'image';
  if (/\.(csv|tsv|json|parquet)$/i.test(s)) return 'dataset';
  return 'article';
}

/**
 * Slugify a title into a filename-safe string.
 */
export function slugify(input: string, max = 60): string {
  return input
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, max) || 'untitled';
}

/**
 * Shell out to defuddle (via npx so users don't need it globally installed).
 * Returns the parsed JSON document.
 */
export interface DefuddleDoc {
  title?: string;
  description?: string;
  content?: string;   // markdown when --md is passed
  author?: string;
  published?: string;
  domain?: string;
  wordCount?: number;
  [k: string]: unknown;
}

export function runDefuddle(source: string): Promise<DefuddleDoc> {
  return new Promise((resolve, reject) => {
    const proc = spawn('npx', ['-y', 'defuddle', 'parse', source, '--json', '--md'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c: Buffer) => { stdout += c.toString('utf-8'); });
    proc.stderr.on('data', (c: Buffer) => { stderr += c.toString('utf-8'); });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`defuddle exited with code ${code}:\n${stderr || stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as DefuddleDoc);
      } catch (e) {
        reject(new Error(`Failed to parse defuddle JSON output: ${(e as Error).message}\nraw: ${stdout.slice(0, 200)}`));
      }
    });
  });
}

/**
 * Build YAML frontmatter from a flat object. Values that are strings are
 * quoted only if they contain special characters. Arrays are rendered as
 * bracket-lists.
 */
function yamlFrontmatter(data: Record<string, unknown>): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${key}: [${value.map(v => JSON.stringify(String(v))).join(', ')}]`);
    } else if (typeof value === 'string') {
      const needsQuote = /[:#"'\n]/.test(value);
      lines.push(`${key}: ${needsQuote ? JSON.stringify(value) : value}`);
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

/**
 * Ingest a URL or local HTML file as an article. Writes raw/articles/<date>-<slug>.md,
 * appends to raw/INGEST-LOG.md, returns the result.
 *
 * If the target file already exists and `overwrite` is false, the existing
 * file is kept and `duplicate: true` is returned.
 */
export async function ingestArticle(
  vaultPath: string,
  source: string,
  opts: { overwrite?: boolean } = {},
): Promise<IngestResult> {
  const doc = await runDefuddle(source);

  const title = (doc.title || doc.description || source).trim();
  const dateStamp = new Date().toISOString().slice(0, 10);
  const slug = slugify(title, 60);
  const filename = `${dateStamp}-${slug}.md`;

  const dir = rawDir(vaultPath, 'articles');
  mkdirSync(dir, { recursive: true });
  const absolutePath = join(dir, filename);
  const relativePath = join('raw', 'articles', filename);

  if (existsSync(absolutePath) && !opts.overwrite) {
    const existing = readFileSync(absolutePath, 'utf-8');
    const wordCount = existing.split(/\s+/).filter(Boolean).length;
    return { type: 'article', path: relativePath, absolutePath, title, wordCount, duplicate: true };
  }

  const frontmatter = yamlFrontmatter({
    title,
    source_url: source,
    source_type: 'article',
    ingested_at: new Date().toISOString(),
    author: doc.author,
    published: doc.published,
    domain: doc.domain,
    tags: ['raw', 'article', 'needs-compile'],
  });

  const body = (doc.content || '').trim();
  const wordCount = body.split(/\s+/).filter(Boolean).length;
  const contents = `${frontmatter}\n\n# ${title}\n\n${body}\n`;
  writeFileSync(absolutePath, contents, 'utf-8');

  appendIngestLog(vaultPath, { type: 'article', path: relativePath, title });

  return { type: 'article', path: relativePath, absolutePath, title, wordCount };
}

/**
 * Append a single line to raw/INGEST-LOG.md. Creates the log if it doesn't
 * exist (with a header that matches obs kb init's scaffold).
 */
export function appendIngestLog(
  vaultPath: string,
  entry: { type: IngestSourceType; path: string; title: string },
): void {
  const log = ingestLogPath(vaultPath);
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `- ${now}  ${entry.type}  ${entry.path}  "${entry.title.replace(/"/g, '\\"')}"\n`;
  if (!existsSync(log)) {
    mkdirSync(join(vaultPath, 'raw'), { recursive: true });
    const header = `# Ingest Log

One line per ingest. Append-only. Used by \`obs kb compile\` to find new raw sources.

Format: \`- <ISO-date>  <type>  <path>  "<title>"\`

---

`;
    writeFileSync(log, header + line, 'utf-8');
    return;
  }
  appendFileSync(log, line, 'utf-8');
}
