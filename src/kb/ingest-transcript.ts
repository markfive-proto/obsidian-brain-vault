import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rawDir } from './paths.js';
import { appendIngestLog, slugify, yamlFrontmatter, type IngestResult } from './ingest.js';

export function parseYoutubeId(source: string): string | null {
  // youtu.be/<id>
  const shortMatch = source.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/i);
  if (shortMatch) return shortMatch[1];
  // youtube.com/watch?v=<id>
  const watchMatch = source.match(/[?&]v=([A-Za-z0-9_-]{6,})/i);
  if (watchMatch) return watchMatch[1];
  // youtube.com/shorts/<id> or /live/<id> or /embed/<id>
  const pathMatch = source.match(/youtube\.com\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{6,})/i);
  if (pathMatch) return pathMatch[1];
  return null;
}

interface YtMeta {
  id: string;
  title: string;
  uploader?: string;
  channel?: string;
  upload_date?: string;          // YYYYMMDD
  duration?: number;             // seconds
  view_count?: number;
  webpage_url?: string;
  description?: string;
}

function ytdlpMeta(url: string): YtMeta {
  const r = spawnSync('yt-dlp', ['--dump-single-json', '--no-warnings', '--skip-download', url], {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
  });
  if (r.status !== 0) {
    throw new Error(`yt-dlp metadata fetch failed (${r.status}): ${r.stderr}`);
  }
  return JSON.parse(r.stdout) as YtMeta;
}

/**
 * Download the auto-generated subtitle file for a video. Prefers English
 * but will accept any language yt-dlp produces. Returns the VTT text.
 */
function fetchAutoSubs(url: string, lang: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'obs-kb-ytsub-'));
  try {
    const r = spawnSync('yt-dlp', [
      '--write-auto-sub',
      '--skip-download',
      '--sub-lang', lang,
      '--sub-format', 'vtt',
      '--no-warnings',
      '-o', join(dir, '%(id)s.%(ext)s'),
      url,
    ], { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });

    if (r.status !== 0) {
      throw new Error(`yt-dlp sub download failed (${r.status}): ${r.stderr}`);
    }

    const vtt = readdirSync(dir).find(f => f.endsWith('.vtt'));
    if (!vtt) throw new Error('yt-dlp produced no .vtt file — no auto-captions for this video?');
    return readFileSync(join(dir, vtt), 'utf-8');
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/**
 * Strip VTT to plain prose. Removes WEBVTT header, cue timings, and
 * collapses duplicate lines (YouTube auto-captions repeat each line
 * twice as a rolling window).
 */
export function cleanVtt(vtt: string): string {
  const lines = vtt.split(/\r?\n/);
  const text: string[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('WEBVTT')) continue;
    if (line.startsWith('NOTE ')) continue;
    if (/^\d+$/.test(line)) continue;                       // cue index
    if (/-->/.test(line)) continue;                         // timing
    if (line.startsWith('Kind:') || line.startsWith('Language:')) continue;
    // Strip inline timing/styling tags like <00:00:01.000> or <c>
    const cleaned = line.replace(/<[^>]+>/g, '').replace(/\{[^}]+\}/g, '').trim();
    if (!cleaned) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    text.push(cleaned);
  }
  return text.join(' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Ingest a YouTube video transcript. Metadata via yt-dlp JSON dump,
 * transcript via the auto-caption VTT. Writes raw/transcripts/<date>-<slug>.md.
 */
export async function ingestTranscript(
  vaultPath: string,
  source: string,
  opts: { overwrite?: boolean; lang?: string } = {},
): Promise<IngestResult> {
  const id = parseYoutubeId(source);
  if (!id) throw new Error(`Not a recognisable YouTube URL: ${source}`);

  const meta = ytdlpMeta(source);
  const vtt = fetchAutoSubs(source, opts.lang ?? 'en');
  const transcript = cleanVtt(vtt);

  const title = meta.title || id;
  const dateStamp =
    meta.upload_date && /^\d{8}$/.test(meta.upload_date)
      ? `${meta.upload_date.slice(0, 4)}-${meta.upload_date.slice(4, 6)}-${meta.upload_date.slice(6, 8)}`
      : new Date().toISOString().slice(0, 10);

  const filename = `${dateStamp}-${slugify(title, 60)}.md`;
  const dir = rawDir(vaultPath, 'transcripts');
  mkdirSync(dir, { recursive: true });
  const absolutePath = join(dir, filename);
  const relativePath = join('raw', 'transcripts', filename);

  if (existsSync(absolutePath) && !opts.overwrite) {
    const existing = readFileSync(absolutePath, 'utf-8');
    const wordCount = existing.split(/\s+/).filter(Boolean).length;
    return { type: 'transcript', path: relativePath, absolutePath, title, wordCount, duplicate: true };
  }

  const frontmatter = yamlFrontmatter({
    title,
    source_url: meta.webpage_url ?? source,
    source_type: 'transcript',
    video_id: id,
    channel: meta.channel ?? meta.uploader,
    uploaded: dateStamp,
    duration_seconds: meta.duration,
    view_count: meta.view_count,
    ingested_at: new Date().toISOString(),
    tags: ['raw', 'transcript', 'needs-compile'],
  });

  const description = meta.description?.trim() ? `\n## Description\n\n${meta.description.trim()}\n` : '';
  const contents = `${frontmatter}\n\n# ${title}${description}\n\n## Transcript\n\n${transcript}\n`;
  writeFileSync(absolutePath, contents, 'utf-8');
  const wordCount = contents.split(/\s+/).filter(Boolean).length;

  appendIngestLog(vaultPath, { type: 'transcript', path: relativePath, title });
  return { type: 'transcript', path: relativePath, absolutePath, title, wordCount };
}
