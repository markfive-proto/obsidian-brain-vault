/**
 * Safe filesystem helpers for reading a vault.
 *
 * Invariants:
 *  - Never read a path that resolves outside the vault root.
 *  - Never read a file larger than 2MB.
 *  - `/file` API only reads `.md` files.
 */

import fs from 'node:fs';
import path from 'node:path';

export const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB

export type VaultDir = 'raw' | 'compiled' | 'outputs';

export const VAULT_DIRS: readonly VaultDir[] = ['raw', 'compiled', 'outputs'] as const;

export interface TreeEntry {
  name: string;
  path: string; // vault-relative, forward-slash
  type: 'file' | 'dir';
  size: number;
  mtime: number; // epoch ms
}

export interface VaultCounts {
  raw: number;
  compiled: number;
  outputs: number;
}

export interface ParsedMarkdown {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export class VaultFsError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message);
    this.name = 'VaultFsError';
  }
}

/**
 * Resolve a user-supplied vault-relative path safely inside `root`.
 * Throws VaultFsError if the path escapes root or contains `..` after resolve.
 */
export function safeJoin(root: string, relative: string): string {
  const normalizedRoot = path.resolve(root);
  // Strip leading slashes so `path.resolve` treats this as relative.
  const cleaned = relative.replace(/^[/\\]+/, '');
  const joined = path.resolve(normalizedRoot, cleaned);
  const rootWithSep = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : normalizedRoot + path.sep;
  if (joined !== normalizedRoot && !joined.startsWith(rootWithSep)) {
    throw new VaultFsError('Path escapes vault root', 400);
  }
  return joined;
}

export function toVaultRelative(root: string, abs: string): string {
  const rel = path.relative(path.resolve(root), abs);
  return rel.split(path.sep).join('/');
}

export function isVaultDir(name: string): name is VaultDir {
  return (VAULT_DIRS as readonly string[]).includes(name);
}

function statSafe(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

export function listTree(root: string, dir: VaultDir): TreeEntry[] {
  const subRoot = path.join(root, dir);
  if (!statSafe(subRoot)?.isDirectory()) return [];
  const out: TreeEntry[] = [];

  const walk = (abs: string) => {
    let items: fs.Dirent[] = [];
    try {
      items = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      if (item.name.startsWith('.')) continue;
      const full = path.join(abs, item.name);
      const rel = toVaultRelative(root, full);
      const st = statSafe(full);
      if (!st) continue;
      if (item.isDirectory()) {
        out.push({
          name: item.name,
          path: rel,
          type: 'dir',
          size: 0,
          mtime: st.mtimeMs,
        });
        walk(full);
      } else if (item.isFile()) {
        out.push({
          name: item.name,
          path: rel,
          type: 'file',
          size: st.size,
          mtime: st.mtimeMs,
        });
      }
    }
  };
  walk(subRoot);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

export function countMarkdown(root: string): VaultCounts {
  const count = (dir: VaultDir): number => {
    const subRoot = path.join(root, dir);
    if (!statSafe(subRoot)?.isDirectory()) return 0;
    let n = 0;
    const walk = (abs: string) => {
      let items: fs.Dirent[] = [];
      try {
        items = fs.readdirSync(abs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const item of items) {
        if (item.name.startsWith('.')) continue;
        const full = path.join(abs, item.name);
        if (item.isDirectory()) walk(full);
        else if (item.isFile() && item.name.endsWith('.md')) n++;
      }
    };
    walk(subRoot);
    return n;
  };
  return { raw: count('raw'), compiled: count('compiled'), outputs: count('outputs') };
}

export function vaultLastModified(root: string): number {
  let latest = 0;
  for (const dir of VAULT_DIRS) {
    const subRoot = path.join(root, dir);
    const st = statSafe(subRoot);
    if (st && st.mtimeMs > latest) latest = st.mtimeMs;
  }
  const rootSt = statSafe(root);
  if (rootSt && rootSt.mtimeMs > latest) latest = rootSt.mtimeMs;
  return latest;
}

/**
 * Very small frontmatter parser. Handles the common YAML-ish cases Brain
 * Vault emits — we avoid pulling in `gray-matter` to keep the dep surface
 * small. Supports `key: value` pairs and list values written inline (`[a, b]`).
 * Everything else is returned as a raw string.
 */
function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  if (!raw.startsWith('---')) {
    return { data: {}, body: raw };
  }
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { data: {}, body: raw };
  const header = raw.slice(3, end).replace(/^\r?\n/, '');
  const afterMarker = raw.slice(end + 4);
  const body = afterMarker.replace(/^\r?\n/, '');

  const data: Record<string, unknown> = {};
  for (const line of header.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_\-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const value = m[2].trim();
    if (value === '') {
      data[key] = '';
      continue;
    }
    if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
      continue;
    }
    const unquoted = value.replace(/^["']|["']$/g, '');
    data[key] = unquoted;
  }
  return { data, body };
}

export function readMarkdown(root: string, relativePath: string): ParsedMarkdown {
  if (!relativePath.endsWith('.md')) {
    throw new VaultFsError('Only .md files are readable', 400);
  }
  const abs = safeJoin(root, relativePath);
  const st = statSafe(abs);
  if (!st || !st.isFile()) {
    throw new VaultFsError('File not found', 404);
  }
  if (st.size > MAX_FILE_BYTES) {
    throw new VaultFsError('File too large', 413);
  }
  const raw = fs.readFileSync(abs, 'utf8');
  const { data, body } = parseFrontmatter(raw);
  return { path: toVaultRelative(root, abs), frontmatter: data, body };
}
