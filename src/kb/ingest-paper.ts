import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rawDir } from './paths.js';
import { appendIngestLog, slugify, yamlFrontmatter, type IngestResult } from './ingest.js';

/**
 * Parse an arXiv id out of a URL. Supports abs/pdf path styles.
 *   https://arxiv.org/abs/2501.12345 → 2501.12345
 *   https://arxiv.org/pdf/2501.12345v2 → 2501.12345v2
 */
export function parseArxivId(source: string): string | null {
  const m = source.match(/arxiv\.org\/(?:abs|pdf)\/([^\/\s?#]+?)(?:\.pdf)?(?:[?#].*)?$/i);
  return m ? m[1] : null;
}

interface ArxivMeta {
  title?: string;
  authors?: string[];
  summary?: string;
  published?: string;
  primaryCategory?: string;
  arxivId: string;
  pdfUrl: string;
}

/** Query arXiv's public API for metadata on an id. Returns null on failure. */
async function fetchArxivMeta(arxivId: string): Promise<ArxivMeta | null> {
  try {
    const res = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`);
    if (!res.ok) return null;
    const xml = await res.text();

    const pickFirst = (tag: string) => {
      const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
      const m = xml.match(re);
      return m ? m[1].trim().replace(/\s+/g, ' ') : undefined;
    };
    const pickAll = (tag: string) => {
      const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
      return Array.from(xml.matchAll(re)).map(m => m[1].trim().replace(/\s+/g, ' '));
    };

    // The first <title> in an arXiv feed is the feed title; the second is the paper's.
    const titles = pickAll('title');
    const title = titles[1] ?? titles[0];
    const nameMatches = Array.from(xml.matchAll(/<author>\s*<name>([^<]+)<\/name>/gi)).map(m => m[1].trim());
    const summary = pickFirst('summary');
    const published = pickFirst('published');
    const catMatch = xml.match(/<arxiv:primary_category[^>]*term="([^"]+)"/i);

    return {
      title,
      authors: nameMatches,
      summary,
      published,
      primaryCategory: catMatch?.[1],
      arxivId,
      pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
    };
  } catch {
    return null;
  }
}

/**
 * Download a URL to a local path. Small helper — for PDFs only, so no
 * streaming required at this scale.
 */
async function downloadTo(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(destPath, buf);
}

/**
 * Run pdftotext on a local PDF. Uses `-layout` to preserve reading order.
 * Returns the extracted plain text.
 */
function pdfToText(pdfPath: string): string {
  const r = spawnSync('pdftotext', ['-layout', '-nopgbrk', pdfPath, '-'], {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`pdftotext failed (${r.status}): ${r.stderr}`);
  }
  return r.stdout;
}

/** Crude splitter: group text by blank-line paragraphs, preserve structure. */
function asMarkdownBody(plain: string): string {
  return plain
    .replace(/\f/g, '\n\n')
    .split(/\n{2,}/)
    .map(para => para.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Ingest a paper from either a local PDF path, an arXiv URL, or a direct
 * PDF URL. Writes raw/papers/<year>-<slug>.md with extracted text +
 * arXiv metadata when available.
 */
export async function ingestPaper(
  vaultPath: string,
  source: string,
  opts: { overwrite?: boolean } = {},
): Promise<IngestResult> {
  const arxivId = parseArxivId(source);
  const isUrl = /^https?:\/\//i.test(source);

  // Resolve a local PDF path: download if URL, otherwise trust the arg.
  let pdfPath = source;
  let tempFiles: string[] = [];
  try {
    if (isUrl) {
      const downloadUrl = arxivId ? `https://arxiv.org/pdf/${arxivId}` : source;
      pdfPath = join(tmpdir(), `obs-kb-paper-${Date.now()}.pdf`);
      tempFiles.push(pdfPath);
      await downloadTo(downloadUrl, pdfPath);
    } else if (!existsSync(pdfPath)) {
      throw new Error(`File not found: ${pdfPath}`);
    }

    const [meta, plainText] = await Promise.all([
      arxivId ? fetchArxivMeta(arxivId) : Promise.resolve(null),
      Promise.resolve(pdfToText(pdfPath)),
    ]);

    const title = (meta?.title || plainText.split('\n').find(l => l.trim().length > 10)?.trim() || 'untitled').slice(0, 200);
    const year = (meta?.published ?? new Date().toISOString()).slice(0, 4);
    const firstAuthorSlug = meta?.authors?.[0]
      ? slugify(meta.authors[0].split(/\s+/).slice(-1)[0], 30)
      : null;
    const titleSlug = slugify(title, 40);
    const filenameBase = firstAuthorSlug
      ? `${year}-${firstAuthorSlug}-${titleSlug}`
      : `${year}-${titleSlug}`;
    const filename = `${filenameBase}.md`;

    const dir = rawDir(vaultPath, 'papers');
    mkdirSync(dir, { recursive: true });
    const absolutePath = join(dir, filename);
    const relativePath = join('raw', 'papers', filename);

    if (existsSync(absolutePath) && !opts.overwrite) {
      const existing = readFileSync(absolutePath, 'utf-8');
      const wordCount = existing.split(/\s+/).filter(Boolean).length;
      return { type: 'paper', path: relativePath, absolutePath, title, wordCount, duplicate: true };
    }

    const body = asMarkdownBody(plainText);
    const wordCount = body.split(/\s+/).filter(Boolean).length;
    const frontmatter = yamlFrontmatter({
      title,
      authors: meta?.authors,
      year,
      arxiv_id: meta?.arxivId ?? arxivId ?? undefined,
      primary_category: meta?.primaryCategory,
      source_url: isUrl ? source : undefined,
      source_path: isUrl ? undefined : source,
      source_type: 'paper',
      ingested_at: new Date().toISOString(),
      tags: ['raw', 'paper', 'needs-compile'],
    });

    const abstractSection = meta?.summary ? `\n## Abstract\n\n${meta.summary}\n` : '';
    const contents = `${frontmatter}\n\n# ${title}\n${abstractSection}\n## Full text\n\n${body}\n`;
    writeFileSync(absolutePath, contents, 'utf-8');

    appendIngestLog(vaultPath, { type: 'paper', path: relativePath, title });
    return { type: 'paper', path: relativePath, absolutePath, title, wordCount };
  } finally {
    for (const f of tempFiles) {
      try { unlinkSync(f); } catch { /* ignore */ }
    }
  }
}
