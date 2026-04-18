import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rawDir } from './paths.js';
import { appendIngestLog, slugify, yamlFrontmatter, type IngestResult } from './ingest.js';

export function parseGithubUrl(source: string): { owner: string; repo: string } | null {
  const m = source.match(/github\.com\/([^\/\s?#]+)\/([^\/\s?#]+?)(?:\.git)?(?:[\/?#].*)?$/i);
  return m ? { owner: m[1], repo: m[2] } : null;
}

function ghApi(path: string): unknown {
  const r = spawnSync('gh', ['api', path], { encoding: 'utf-8', maxBuffer: 20 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`gh api ${path} failed (${r.status}): ${r.stderr}`);
  }
  return JSON.parse(r.stdout);
}

interface RepoMeta {
  full_name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  topics: string[];
  license: { spdx_id?: string; name?: string } | null;
  default_branch: string;
  homepage: string | null;
  pushed_at: string;
  html_url: string;
}

interface ReadmeMeta {
  content: string;   // base64
  name: string;
  path: string;
}

/**
 * Ingest a GitHub repo into raw/repos/<owner>-<repo>.md. Uses `gh api`
 * for metadata + README. Does NOT clone the source — the README + a
 * structured metadata block is what downstream compile cares about.
 */
export async function ingestRepo(
  vaultPath: string,
  source: string,
  opts: { overwrite?: boolean } = {},
): Promise<IngestResult> {
  const parsed = parseGithubUrl(source);
  if (!parsed) throw new Error(`Not a recognisable GitHub URL: ${source}`);
  const { owner, repo } = parsed;

  const meta = ghApi(`repos/${owner}/${repo}`) as RepoMeta;
  let readmeBody = '';
  try {
    const readme = ghApi(`repos/${owner}/${repo}/readme`) as ReadmeMeta;
    readmeBody = Buffer.from(readme.content, 'base64').toString('utf-8');
  } catch {
    readmeBody = '_(no README.md found in this repo)_';
  }

  const title = meta.full_name;
  const filename = `${slugify(owner, 30)}-${slugify(repo, 60)}.md`;
  const dir = rawDir(vaultPath, 'repos');
  mkdirSync(dir, { recursive: true });
  const absolutePath = join(dir, filename);
  const relativePath = join('raw', 'repos', filename);

  if (existsSync(absolutePath) && !opts.overwrite) {
    const existing = readFileSync(absolutePath, 'utf-8');
    const wordCount = existing.split(/\s+/).filter(Boolean).length;
    return { type: 'repo', path: relativePath, absolutePath, title, wordCount, duplicate: true };
  }

  const frontmatter = yamlFrontmatter({
    title,
    source_url: meta.html_url,
    source_type: 'repo',
    owner,
    repo,
    description: meta.description ?? undefined,
    homepage: meta.homepage ?? undefined,
    language: meta.language ?? undefined,
    stars: meta.stargazers_count,
    license: meta.license?.spdx_id ?? meta.license?.name ?? undefined,
    default_branch: meta.default_branch,
    topics: meta.topics,
    pushed_at: meta.pushed_at,
    ingested_at: new Date().toISOString(),
    tags: ['raw', 'repo', 'needs-compile'],
  });

  const metaBlock = [
    `**Repo:** [${meta.full_name}](${meta.html_url})`,
    meta.description ? `**Description:** ${meta.description}` : null,
    meta.language ? `**Language:** ${meta.language}` : null,
    `**Stars:** ${meta.stargazers_count.toLocaleString()}`,
    meta.license ? `**License:** ${meta.license.spdx_id ?? meta.license.name}` : null,
    meta.topics.length ? `**Topics:** ${meta.topics.map(t => `\`${t}\``).join(', ')}` : null,
    meta.homepage ? `**Homepage:** ${meta.homepage}` : null,
  ].filter(Boolean).join('\n');

  const contents = `${frontmatter}\n\n# ${title}\n\n${metaBlock}\n\n## README\n\n${readmeBody}\n`;
  writeFileSync(absolutePath, contents, 'utf-8');
  const wordCount = contents.split(/\s+/).filter(Boolean).length;

  appendIngestLog(vaultPath, { type: 'repo', path: relativePath, title });
  return { type: 'repo', path: relativePath, absolutePath, title, wordCount };
}
