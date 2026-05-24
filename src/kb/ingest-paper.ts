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

interface PdfinfoMeta {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  date?: string;  // YYYY-MM-DD
}

/**
 * Extract metadata from PDF using pdfinfo. Much more reliable than scanning
 * body text for titles — covers author, creation date, and embedded keywords.
 * Returns empty object if pdfinfo is unavailable or the PDF has no metadata.
 */
function extractPdfinfoMeta(pdfPath: string): PdfinfoMeta {
  const r = spawnSync('pdfinfo', [pdfPath], { encoding: 'utf-8' });
  if (r.status !== 0 || !r.stdout) return {};

  const lines = r.stdout.split('\n');
  const get = (key: string): string | undefined => {
    const line = lines.find(l => l.toLowerCase().startsWith(key.toLowerCase() + ':'));
    return line ? line.slice(line.indexOf(':') + 1).trim() : undefined;
  };

  const rawDate = get('CreationDate');
  let date: string | undefined;
  if (rawDate) {
    // pdfinfo dates: "Mon Jan 15 10:30:00 2024" or "2024-01-15 10:30:00"
    try {
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) date = d.toISOString().slice(0, 10);
    } catch { /* ignore */ }
  }

  const rawKeywords = get('Keywords');
  const keywords = rawKeywords
    ? rawKeywords.split(/[,;]/).map(k => k.trim()).filter(Boolean)
    : undefined;

  return {
    title: get('Title') || undefined,
    author: get('Author') || undefined,
    subject: get('Subject') || undefined,
    keywords,
    date,
  };
}

/**
 * Find the most likely title line from raw PDF text. Skips blank lines,
 * lines that look like page numbers or copyright notices, and prefers the
 * first substantial line (>20 chars, not all-caps short string).
 */
function extractTitleFromText(plainText: string): string | undefined {
  const lines = plainText.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 30)) {
    // Skip page headers/footers: numbers, short all-caps, copyright lines
    if (/^\d+$/.test(line)) continue;
    if (/^(page|copyright|\(c\)|©|\d{4}\s*(IEEE|ACM|Springer))/i.test(line)) continue;
    if (line.length < 8) continue;
    // Prefer lines >20 chars that aren't pure uppercase abbreviations
    if (line.length >= 20 || (line.length >= 8 && !/^[A-Z\s\d]+$/.test(line))) {
      return line.slice(0, 200);
    }
  }
  return undefined;
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

    // For non-arXiv PDFs, pull richer metadata from the PDF's own metadata fields.
    const pdfinfoMeta = !arxivId ? extractPdfinfoMeta(pdfPath) : {};

    const title = (
      meta?.title ||
      pdfinfoMeta.title ||
      extractTitleFromText(plainText) ||
      'untitled'
    ).slice(0, 200);

    const dateStr = (meta?.published ?? pdfinfoMeta.date ?? new Date().toISOString()).slice(0, 10);
    const year = dateStr.slice(0, 4);

    const authors: string[] | undefined = meta?.authors ??
      (pdfinfoMeta.author ? pdfinfoMeta.author.split(/[,;&]/).map(a => a.trim()).filter(Boolean) : undefined);

    const firstAuthorSlug = authors?.[0]
      ? slugify(authors[0].split(/\s+/).slice(-1)[0], 30)
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
      date: dateStr,
      authors,
      year,
      arxiv_id: meta?.arxivId ?? arxivId ?? undefined,
      primary_category: meta?.primaryCategory,
      subject: pdfinfoMeta.subject ?? undefined,
      keywords: pdfinfoMeta.keywords?.length ? pdfinfoMeta.keywords : undefined,
      source_url: isUrl ? source : undefined,
      source_path: isUrl ? undefined : source,
      source_type: arxivId ? 'paper' : 'pdf',
      ingested_at: new Date().toISOString(),
      tags: ['raw', arxivId ? 'paper' : 'pdf', 'needs-compile'],
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
