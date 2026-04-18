import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { rawDir } from './paths.js';
import { appendIngestLog, slugify, yamlFrontmatter } from './ingest.js';

export interface IngestCodebaseOptions {
  overwrite?: boolean;
  includeDocs?: boolean;
  includePlans?: boolean;
  includeHistory?: boolean;
  includeIssues?: boolean;
  maxHistoryCommits?: number;
  maxFileSize?: number;
  onProgress?: (msg: string) => void;
}

export interface IngestCodebaseResult {
  repoRoot: string;
  repoSlug: string;
  filesIngested: string[];
  skipped: Array<{ path: string; reason: string }>;
  remote?: string;
  totalBytes: number;
}

type Subtype =
  | 'readme'
  | 'roadmap'
  | 'changelog'
  | 'docs'
  | 'stack'
  | 'history'
  | 'issues'
  | 'architecture'
  | 'agents'
  | 'plan'
  | 'contributing'
  | 'other';

const ROOT_DOC_MAP: Record<string, Subtype> = {
  'readme.md': 'readme',
  'agents.md': 'agents',
  'claude.md': 'agents',
  'contributing.md': 'contributing',
  'architecture.md': 'architecture',
  'design.md': 'architecture',
  'roadmap.md': 'roadmap',
  'vision.md': 'roadmap',
  'code_of_conduct.md': 'other',
  'history.md': 'changelog',
  'changelog.md': 'changelog',
};

const IGNORED_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'build',
  'out',
  'target',
  '.venv',
  'venv',
  'vendor',
  '__pycache__',
  '.git',
  '.turbo',
  '.cache',
  'coverage',
]);

const DEFAULT_MAX_SIZE = 1_048_576;

// ---- Pure helpers ----------------------------------------------------------

export function parseGitRemote(
  remoteUrl: string,
): { host: string; owner: string; repo: string } | null {
  const trimmed = remoteUrl.trim();
  const sshMatch = trimmed.match(/^git@([^:]+):([^\/]+)\/(.+?)(?:\.git)?\/?$/i);
  if (sshMatch) {
    return { host: sshMatch[1], owner: sshMatch[2], repo: sshMatch[3] };
  }
  const httpsMatch = trimmed.match(/^https?:\/\/([^\/]+)\/([^\/]+)\/(.+?)(?:\.git)?\/?$/i);
  if (httpsMatch) {
    return { host: httpsMatch[1], owner: httpsMatch[2], repo: httpsMatch[3] };
  }
  return null;
}

export function detectRepoSlug(repoPath: string, remote?: string): string {
  if (remote) {
    const parsed = parseGitRemote(remote);
    if (parsed) return slugify(`${parsed.owner}-${parsed.repo}`, 80);
  }
  return slugify(basename(repoPath.replace(/\/+$/, '')) || 'repo', 80);
}

export function parseGitignoreIntoGlobs(content: string): string[] {
  const globs: string[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;
    if (line.startsWith('!')) continue;
    globs.push(line);
  }
  return globs;
}

function globToRegex(pattern: string): RegExp {
  let p = pattern;
  const anchored = p.startsWith('/');
  if (anchored) p = p.slice(1);
  const dirOnly = p.endsWith('/');
  if (dirOnly) p = p.slice(0, -1);

  let re = '';
  let i = 0;
  while (i < p.length) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        re += '.*';
        i += 2;
        if (p[i] === '/') i += 1;
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      re += '[^/]';
      i += 1;
    } else if ('.+^$()|{}[]\\'.includes(c)) {
      re += '\\' + c;
      i += 1;
    } else {
      re += c;
      i += 1;
    }
  }

  const prefix = anchored ? '^' : '(^|.*/)';
  const suffix = dirOnly ? '(/.*)?$' : '(/.*)?$';
  return new RegExp(prefix + re + suffix);
}

export function shouldIngestPath(relPath: string, gitignoreGlobs: string[]): boolean {
  const norm = relPath.replace(/\\/g, '/');
  const parts = norm.split('/');
  for (const part of parts) {
    if (IGNORED_DIRS.has(part)) return false;
  }
  for (const g of gitignoreGlobs) {
    try {
      if (globToRegex(g).test(norm)) return false;
    } catch {
      // malformed glob — skip
    }
  }
  return true;
}

// ---- I/O helpers -----------------------------------------------------------

function runGit(repoPath: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync('git', args, {
    cwd: repoPath,
    encoding: 'utf-8',
    maxBuffer: 20 * 1024 * 1024,
  });
  return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function getGitRemote(repoPath: string): string | undefined {
  const r = runGit(repoPath, ['remote', 'get-url', 'origin']);
  if (!r.ok) return undefined;
  const url = r.stdout.trim();
  return url || undefined;
}

function hasGhAndAuth(): boolean {
  const which = spawnSync('which', ['gh'], { encoding: 'utf-8' });
  if (which.status !== 0) return false;
  const auth = spawnSync('gh', ['auth', 'status', '--hostname', 'github.com'], {
    encoding: 'utf-8',
  });
  return auth.status === 0;
}

function walkFiles(
  root: string,
  rel: string,
  out: string[],
  gitignoreGlobs: string[],
  maxDepth: number,
): void {
  if (maxDepth < 0) return;
  let entries: string[];
  try {
    entries = readdirSync(join(root, rel));
  } catch {
    return;
  }
  for (const entry of entries) {
    const entryRel = rel ? `${rel}/${entry}` : entry;
    if (!shouldIngestPath(entryRel, gitignoreGlobs)) continue;
    let st;
    try {
      st = statSync(join(root, entryRel));
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkFiles(root, entryRel, out, gitignoreGlobs, maxDepth - 1);
    } else if (st.isFile()) {
      out.push(entryRel);
    }
  }
}

function findRootDoc(entries: string[], target: string): string | undefined {
  const lower = target.toLowerCase();
  return entries.find(e => e.toLowerCase() === lower);
}

// ---- Stack parsing ---------------------------------------------------------

interface StackSummary {
  source: string;
  lines: string[];
}

function parseStackFiles(repoPath: string): StackSummary[] {
  const out: StackSummary[] = [];

  const pkgPath = join(repoPath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
      const deps = Object.keys((pkg.dependencies as Record<string, string>) ?? {});
      const devDeps = Object.keys((pkg.devDependencies as Record<string, string>) ?? {});
      const scripts = Object.entries((pkg.scripts as Record<string, string>) ?? {});
      out.push({
        source: 'package.json',
        lines: [
          `## package.json`,
          `- name: ${pkg.name ?? '(none)'}`,
          `- version: ${pkg.version ?? '(none)'}`,
          `- description: ${pkg.description ?? '(none)'}`,
          `- dependencies: ${deps.length}`,
          `- devDependencies: ${devDeps.length}`,
          `- scripts:`,
          ...scripts.map(([k, v]) => `  - \`${k}\`: \`${v}\``),
          deps.length > 0 ? `- top deps: ${deps.slice(0, 20).join(', ')}` : '',
        ].filter(Boolean),
      });
    } catch {
      // ignore
    }
  }

  const pyproject = join(repoPath, 'pyproject.toml');
  if (existsSync(pyproject)) {
    const text = readFileSync(pyproject, 'utf-8');
    const name = text.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
    const version = text.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
    const description = text.match(/^\s*description\s*=\s*"([^"]+)"/m)?.[1];
    out.push({
      source: 'pyproject.toml',
      lines: [
        `## pyproject.toml`,
        `- name: ${name ?? '(none)'}`,
        `- version: ${version ?? '(none)'}`,
        `- description: ${description ?? '(none)'}`,
      ],
    });
  }

  const cargo = join(repoPath, 'Cargo.toml');
  if (existsSync(cargo)) {
    const text = readFileSync(cargo, 'utf-8');
    const name = text.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
    const version = text.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
    const description = text.match(/^\s*description\s*=\s*"([^"]+)"/m)?.[1];
    out.push({
      source: 'Cargo.toml',
      lines: [
        `## Cargo.toml`,
        `- name: ${name ?? '(none)'}`,
        `- version: ${version ?? '(none)'}`,
        `- description: ${description ?? '(none)'}`,
      ],
    });
  }

  const gomod = join(repoPath, 'go.mod');
  if (existsSync(gomod)) {
    const text = readFileSync(gomod, 'utf-8');
    const module = text.match(/^module\s+(\S+)/m)?.[1];
    const goVer = text.match(/^go\s+(\S+)/m)?.[1];
    out.push({
      source: 'go.mod',
      lines: [`## go.mod`, `- module: ${module ?? '(none)'}`, `- go: ${goVer ?? '(none)'}`],
    });
  }

  const gemfile = join(repoPath, 'Gemfile');
  if (existsSync(gemfile)) {
    out.push({ source: 'Gemfile', lines: [`## Gemfile`, `- present`] });
  }

  const composer = join(repoPath, 'composer.json');
  if (existsSync(composer)) {
    try {
      const j = JSON.parse(readFileSync(composer, 'utf-8')) as Record<string, unknown>;
      out.push({
        source: 'composer.json',
        lines: [
          `## composer.json`,
          `- name: ${j.name ?? '(none)'}`,
          `- description: ${j.description ?? '(none)'}`,
        ],
      });
    } catch {
      // ignore
    }
  }

  return out;
}

// ---- Writers ---------------------------------------------------------------

function writeRawFile(
  vaultPath: string,
  filename: string,
  frontmatter: string,
  body: string,
  overwrite: boolean,
): { relativePath: string; absolutePath: string; duplicate: boolean; bytes: number } {
  const dir = rawDir(vaultPath, 'codebase');
  mkdirSync(dir, { recursive: true });
  const absolutePath = join(dir, filename);
  const relativePath = join('raw', 'codebase', filename);
  if (existsSync(absolutePath) && !overwrite) {
    return { relativePath, absolutePath, duplicate: true, bytes: 0 };
  }
  const contents = `${frontmatter}\n\n${body}\n`;
  writeFileSync(absolutePath, contents, 'utf-8');
  return { relativePath, absolutePath, duplicate: false, bytes: Buffer.byteLength(contents, 'utf-8') };
}

function buildFrontmatter(args: {
  title: string;
  subtype: Subtype;
  sourcePath: string;
  repoSlug: string;
  repoRoot: string;
}): string {
  return yamlFrontmatter({
    title: args.title,
    source_type: 'codebase',
    source_subtype: args.subtype,
    source_path: args.sourcePath,
    repo_slug: args.repoSlug,
    repo_root: args.repoRoot,
    ingested_at: new Date().toISOString(),
    tags: ['raw', 'codebase', args.subtype, 'needs-compile'],
  });
}

// ---- Main ------------------------------------------------------------------

export async function ingestCodebase(
  vaultPath: string,
  repoPath: string,
  opts: IngestCodebaseOptions = {},
): Promise<IngestCodebaseResult> {
  const overwrite = opts.overwrite ?? false;
  const includeDocs = opts.includeDocs ?? true;
  const includePlans = opts.includePlans ?? true;
  const includeHistory = opts.includeHistory ?? true;
  const includeIssues = opts.includeIssues ?? true;
  const maxHistoryCommits = opts.maxHistoryCommits ?? 200;
  const maxFileSize = opts.maxFileSize ?? DEFAULT_MAX_SIZE;
  const progress = opts.onProgress ?? (() => {});

  if (!existsSync(repoPath) || !statSync(repoPath).isDirectory()) {
    throw new Error(`Not a directory: ${repoPath}`);
  }
  if (!existsSync(join(repoPath, '.git'))) {
    throw new Error(`Not a git repo (no .git dir): ${repoPath}`);
  }

  const remote = getGitRemote(repoPath);
  const repoSlug = detectRepoSlug(repoPath, remote);
  const dateStamp = new Date().toISOString().slice(0, 10);

  const gitignorePath = join(repoPath, '.gitignore');
  const gitignoreGlobs = existsSync(gitignorePath)
    ? parseGitignoreIntoGlobs(readFileSync(gitignorePath, 'utf-8'))
    : [];

  const filesIngested: string[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  let totalBytes = 0;

  const rootEntries = readdirSync(repoPath);

  const ingestOne = (
    absPath: string,
    relSourcePath: string,
    subtype: Subtype,
    filename: string,
    title: string,
  ): void => {
    try {
      const st = statSync(absPath);
      if (st.size > maxFileSize) {
        skipped.push({ path: relSourcePath, reason: `>${maxFileSize} bytes` });
        return;
      }
      const body = readFileSync(absPath, 'utf-8');
      const fm = buildFrontmatter({
        title,
        subtype,
        sourcePath: absPath,
        repoSlug,
        repoRoot: repoPath,
      });
      const res = writeRawFile(vaultPath, filename, fm, body, overwrite);
      if (res.duplicate) {
        skipped.push({ path: relSourcePath, reason: 'already-ingested' });
        return;
      }
      filesIngested.push(res.relativePath);
      totalBytes += res.bytes;
      appendIngestLog(vaultPath, { type: 'repo', path: res.relativePath, title });
      progress(`ingested ${relSourcePath}`);
    } catch (e) {
      skipped.push({ path: relSourcePath, reason: (e as Error).message });
    }
  };

  // Root docs
  for (const [docName, subtype] of Object.entries(ROOT_DOC_MAP)) {
    const found = findRootDoc(rootEntries, docName);
    if (!found) continue;
    const abs = join(repoPath, found);
    const docSlug = slugify(docName.replace(/\.md$/, ''), 30);
    const filename = `${dateStamp}-${docSlug}-${repoSlug}.md`;
    const title = `${found} — ${repoSlug}`;
    ingestOne(abs, found, subtype, filename, title);
  }

  // docs/**/*.md and plans/**/*.md
  const walkCollections: Array<{ dir: string; subtype: Subtype; enabled: boolean }> = [
    { dir: 'docs', subtype: 'docs', enabled: includeDocs },
    { dir: 'plans', subtype: 'plan', enabled: includePlans },
  ];
  for (const col of walkCollections) {
    if (!col.enabled) continue;
    const absDir = join(repoPath, col.dir);
    if (!existsSync(absDir) || !statSync(absDir).isDirectory()) continue;
    const collected: string[] = [];
    walkFiles(repoPath, col.dir, collected, gitignoreGlobs, 8);
    for (const rel of collected) {
      if (!rel.toLowerCase().endsWith('.md')) continue;
      if (/\.generated\./i.test(rel) || /\bauto-generated\b/i.test(rel)) {
        skipped.push({ path: rel, reason: 'looks auto-generated' });
        continue;
      }
      const abs = join(repoPath, rel);
      const relSlug = slugify(rel.replace(/\//g, '-').replace(/\.md$/, ''), 80);
      const filename = `${dateStamp}-${col.subtype}-${relSlug}.md`;
      const title = `${rel} — ${repoSlug}`;
      ingestOne(abs, rel, col.subtype, filename, title);
    }
  }

  // Stack summary (aggregate)
  const stackSummaries = parseStackFiles(repoPath);
  if (stackSummaries.length > 0) {
    const filename = `${dateStamp}-stack-${repoSlug}.md`;
    const body = [
      `# Stack summary — ${repoSlug}`,
      '',
      `Repo: \`${repoPath}\``,
      remote ? `Remote: ${remote}` : '',
      '',
      ...stackSummaries.flatMap(s => [...s.lines, '']),
    ]
      .filter(Boolean)
      .join('\n');
    const fm = buildFrontmatter({
      title: `Stack — ${repoSlug}`,
      subtype: 'stack',
      sourcePath: repoPath,
      repoSlug,
      repoRoot: repoPath,
    });
    const res = writeRawFile(vaultPath, filename, fm, body, overwrite);
    if (!res.duplicate) {
      filesIngested.push(res.relativePath);
      totalBytes += res.bytes;
      appendIngestLog(vaultPath, { type: 'repo', path: res.relativePath, title: `Stack — ${repoSlug}` });
      progress(`ingested stack summary`);
    } else {
      skipped.push({ path: 'stack', reason: 'already-ingested' });
    }
  }

  // History summary
  if (includeHistory) {
    const oneLine = runGit(repoPath, ['log', '--oneline', '--no-merges', `-n`, String(maxHistoryCommits)]);
    const detailed = runGit(repoPath, [
      'log',
      '--no-merges',
      '-n',
      '30',
      '--pretty=format:%h %ad %an%n%s%n%n%b%n---',
      '--date=short',
    ]);
    if (oneLine.ok) {
      const filename = `${dateStamp}-history-${repoSlug}.md`;
      const body = [
        `# Git history — ${repoSlug}`,
        '',
        `## Recent shipping (last 30 commits, full messages)`,
        '',
        '```',
        detailed.stdout.trim() || '(no commits)',
        '```',
        '',
        `## Full log (oneline, last ${maxHistoryCommits})`,
        '',
        '```',
        oneLine.stdout.trim() || '(no commits)',
        '```',
      ].join('\n');
      const fm = buildFrontmatter({
        title: `History — ${repoSlug}`,
        subtype: 'history',
        sourcePath: repoPath,
        repoSlug,
        repoRoot: repoPath,
      });
      const res = writeRawFile(vaultPath, filename, fm, body, overwrite);
      if (!res.duplicate) {
        filesIngested.push(res.relativePath);
        totalBytes += res.bytes;
        appendIngestLog(vaultPath, {
          type: 'repo',
          path: res.relativePath,
          title: `History — ${repoSlug}`,
        });
        progress(`ingested git history`);
      } else {
        skipped.push({ path: 'history', reason: 'already-ingested' });
      }
    } else {
      skipped.push({ path: 'history', reason: 'git log failed' });
    }
  }

  // Issues (optional)
  if (includeIssues && remote && hasGhAndAuth()) {
    const r = spawnSync(
      'gh',
      [
        'issue',
        'list',
        '--state',
        'open',
        '--limit',
        '100',
        '--json',
        'number,title,labels,author,createdAt',
      ],
      { cwd: repoPath, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
    );
    if (r.status === 0) {
      try {
        const issues = JSON.parse(r.stdout) as Array<{
          number: number;
          title: string;
          labels: Array<{ name: string }>;
          author: { login: string };
          createdAt: string;
        }>;
        const filename = `${dateStamp}-issues-${repoSlug}.md`;
        const lines = [
          `# Open issues — ${repoSlug}`,
          '',
          `Total open: ${issues.length}`,
          '',
          ...issues.map(i => {
            const ageDays = Math.round(
              (Date.now() - new Date(i.createdAt).getTime()) / (1000 * 60 * 60 * 24),
            );
            const labels = i.labels.map(l => l.name).join(', ');
            return `- #${i.number} — ${i.title} — @${i.author?.login ?? 'unknown'} — ${ageDays}d — [${labels}]`;
          }),
        ];
        const fm = buildFrontmatter({
          title: `Issues — ${repoSlug}`,
          subtype: 'issues',
          sourcePath: remote,
          repoSlug,
          repoRoot: repoPath,
        });
        const res = writeRawFile(vaultPath, filename, fm, lines.join('\n'), overwrite);
        if (!res.duplicate) {
          filesIngested.push(res.relativePath);
          totalBytes += res.bytes;
          appendIngestLog(vaultPath, {
            type: 'repo',
            path: res.relativePath,
            title: `Issues — ${repoSlug}`,
          });
          progress(`ingested open issues`);
        } else {
          skipped.push({ path: 'issues', reason: 'already-ingested' });
        }
      } catch (e) {
        skipped.push({ path: 'issues', reason: (e as Error).message });
      }
    } else {
      skipped.push({ path: 'issues', reason: 'gh issue list failed' });
    }
  } else if (includeIssues) {
    skipped.push({ path: 'issues', reason: 'gh missing or unauthenticated or no remote' });
  }

  return {
    repoRoot: repoPath,
    repoSlug,
    filesIngested,
    skipped,
    remote,
    totalBytes,
  };
}
