import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export type FetcherKind = 'spider' | 'defuddle' | 'auto';

export interface FetchResult {
  /** Absolute path to a local HTML file that downstream extractors can read. */
  htmlPath: string;
  /** How this HTML was obtained. */
  via: 'spider' | 'defuddle';
  /** Temp-dir cleanup function. Call after extraction. */
  cleanup: () => void;
}

/** True if the `spider` binary is on PATH. */
export function spiderAvailable(): boolean {
  const r = spawnSync('which', ['spider'], { stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0 && r.stdout.toString().trim().length > 0;
}

/**
 * Fetch a URL via spider-rs into a freshly-created temp dir. Returns the
 * path of the single HTML file spider wrote (the index/entry page).
 *
 * We use `--http` to force plain HTTP mode (no Chrome), which is fast and
 * sufficient for most article-style pages. Pages that require JS execution
 * should be handled by a future `--headless` escalation.
 */
export async function fetchWithSpider(url: string): Promise<FetchResult> {
  const dir = mkdtempSync(join(tmpdir(), 'obs-kb-ingest-'));

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      'spider',
      ['--url', url, '--http', 'download', '--target-destination', dir],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    proc.stderr.on('data', c => { stderr += c.toString('utf-8'); });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`spider exited with code ${code}: ${stderr}`));
    });
  });

  // Spider may download a single page or a small set (related links, budget-respecting).
  // We want the page that matches the URL's final path segment — or fall back
  // to the largest HTML file.
  const files = readdirSync(dir).filter(f => f.endsWith('.html'));
  if (files.length === 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`spider wrote no HTML files to ${dir}`);
  }

  // Prefer an exact filename match with the URL slug
  const urlSlug = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
  const targetName = urlSlug.endsWith('.html') ? urlSlug : `${urlSlug || 'index'}.html`;
  let chosen = files.find(f => f === targetName);
  if (!chosen) {
    // Fallback: largest file
    chosen = files
      .map(f => ({ name: f, size: readFileSync(join(dir, f)).length }))
      .sort((a, b) => b.size - a.size)[0].name;
  }

  const htmlPath = join(dir, chosen);
  return {
    htmlPath,
    via: 'spider',
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * Ask defuddle to fetch the URL itself (its built-in fetcher). Returns
 * a path to a temp file containing the URL so the ingest pipeline can
 * treat spider-fetched and defuddle-fetched paths uniformly.
 *
 * Defuddle accepts URLs directly, so we don't actually write a file here
 * — we return the URL as the `htmlPath` and signal `via: 'defuddle'` so
 * the caller knows to pass it to defuddle as a URL argument, not a file.
 */
export function fetchWithDefuddle(url: string): FetchResult {
  return {
    htmlPath: url, // defuddle accepts URLs directly
    via: 'defuddle',
    cleanup: () => {},
  };
}

/**
 * Pick the best fetcher for a URL based on availability + the `which`
 * option. Order mirrors the user's scraping hierarchy:
 *   spider-rs (fastest, local Rust)  →  defuddle (built-in fetcher, fallback)
 */
export async function fetchHtml(url: string, which: FetcherKind = 'auto'): Promise<FetchResult> {
  if (which === 'defuddle') return fetchWithDefuddle(url);
  if (which === 'spider' || (which === 'auto' && spiderAvailable())) {
    try {
      return await fetchWithSpider(url);
    } catch (err) {
      if (which === 'spider') throw err;
      // Auto mode: fall back to defuddle on spider error
      return fetchWithDefuddle(url);
    }
  }
  return fetchWithDefuddle(url);
}
