import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { getVaultPath } from './config.js';

export type VaultKind = 'project' | 'topic' | 'vault';

export interface VaultEntry {
  name: string;
  path: string;
  kind: VaultKind;
  created: string;
  description?: string;
}

export interface Workspace {
  default: string | null;
  vaults: VaultEntry[];
}

export interface UserConfig {
  user?: string;
  defaultProvider?: 'anthropic' | 'openai' | 'google';
}

const DEFAULT_UNIVERSE = join(homedir(), '.obs');

export const UNIVERSE_DIR: string = DEFAULT_UNIVERSE;

export function universeDir(): string {
  const override = process.env.OBS_HOME;
  return override && override.length > 0 ? override : DEFAULT_UNIVERSE;
}

export function workspaceYamlPath(): string {
  return join(universeDir(), 'workspace.yaml');
}

export function userConfigYamlPath(): string {
  return join(universeDir(), 'config.yaml');
}

function ensureUniverseDir(): void {
  const dir = universeDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

const VAULT_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

export function isValidVaultName(name: string): boolean {
  if (typeof name !== 'string') return false;
  if (name.length < 1 || name.length > 60) return false;
  return VAULT_NAME_RE.test(name);
}

function isValidKind(value: unknown): value is VaultKind {
  return value === 'project' || value === 'topic' || value === 'vault';
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function needsQuoting(value: string): boolean {
  if (value.length === 0) return true;
  if (/^[\s"'#&*!|>%@`]/.test(value)) return true;
  if (/[:#]/.test(value)) return true;
  if (/^(true|false|null|yes|no|~)$/i.test(value)) return true;
  if (/^-?\d/.test(value)) return true;
  return false;
}

function quote(value: string): string {
  if (!needsQuoting(value)) return value;
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function parseScalar(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === '~' || trimmed.toLowerCase() === 'null') {
    return null;
  }
  return stripQuotes(trimmed);
}

interface ParsedYaml {
  [key: string]: unknown;
}

function parseYaml(text: string): ParsedYaml {
  const lines = text.split(/\r?\n/);
  const root: ParsedYaml = {};
  let i = 0;

  const indentOf = (line: string): number => line.length - line.trimStart().length;

  const parseList = (baseIndent: number): unknown[] => {
    const items: unknown[] = [];
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === '' || line.trim().startsWith('#')) {
        i++;
        continue;
      }
      const ind = indentOf(line);
      if (ind < baseIndent) return items;
      const stripped = line.slice(ind);
      if (!stripped.startsWith('- ')) return items;
      if (ind !== baseIndent) return items;

      const rest = stripped.slice(2);
      const colonIdx = rest.indexOf(':');
      if (colonIdx === -1) {
        items.push(parseScalar(rest));
        i++;
        continue;
      }

      const obj: ParsedYaml = {};
      const firstKey = rest.slice(0, colonIdx).trim();
      const firstVal = rest.slice(colonIdx + 1).trim();
      if (firstVal.length > 0) {
        obj[firstKey] = parseScalar(firstVal);
      } else {
        obj[firstKey] = null;
      }
      i++;

      const childIndent = baseIndent + 2;
      while (i < lines.length) {
        const sub = lines[i];
        if (sub.trim() === '' || sub.trim().startsWith('#')) {
          i++;
          continue;
        }
        const sInd = indentOf(sub);
        if (sInd < childIndent) break;
        if (sub.slice(sInd).startsWith('- ')) break;
        const subStripped = sub.slice(sInd);
        const cIdx = subStripped.indexOf(':');
        if (cIdx === -1) {
          i++;
          continue;
        }
        const k = subStripped.slice(0, cIdx).trim();
        const v = subStripped.slice(cIdx + 1).trim();
        obj[k] = parseScalar(v);
        i++;
      }
      items.push(obj);
    }
    return items;
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) {
      i++;
      continue;
    }
    const ind = indentOf(line);
    if (ind !== 0) {
      i++;
      continue;
    }
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      i++;
      continue;
    }
    const key = line.slice(0, colonIdx).trim();
    const rest = line.slice(colonIdx + 1).trim();
    i++;

    if (rest.length > 0) {
      root[key] = parseScalar(rest);
      continue;
    }

    // Look ahead: is next non-empty line a list?
    let peek = i;
    while (peek < lines.length && (lines[peek].trim() === '' || lines[peek].trim().startsWith('#'))) {
      peek++;
    }
    if (peek < lines.length) {
      const next = lines[peek];
      const nInd = indentOf(next);
      const nStripped = next.slice(nInd);
      if (nStripped.startsWith('- ')) {
        root[key] = parseList(nInd);
        continue;
      }
    }
    root[key] = null;
  }

  return root;
}

function serializeWorkspace(ws: Workspace): string {
  const lines: string[] = [];
  lines.push(`default: ${ws.default === null ? 'null' : quote(ws.default)}`);
  if (ws.vaults.length === 0) {
    lines.push('vaults: []');
  } else {
    lines.push('vaults:');
    for (const v of ws.vaults) {
      lines.push(`  - name: ${quote(v.name)}`);
      lines.push(`    path: ${quote(v.path)}`);
      lines.push(`    kind: ${v.kind}`);
      lines.push(`    created: ${quote(v.created)}`);
      if (v.description !== undefined) {
        lines.push(`    description: ${quote(v.description)}`);
      }
    }
  }
  return lines.join('\n') + '\n';
}

function serializeUserConfig(cfg: UserConfig): string {
  const lines: string[] = [];
  if (cfg.user !== undefined) lines.push(`user: ${quote(cfg.user)}`);
  if (cfg.defaultProvider !== undefined) lines.push(`defaultProvider: ${cfg.defaultProvider}`);
  if (lines.length === 0) return '{}\n';
  return lines.join('\n') + '\n';
}

function coerceVaultEntry(raw: unknown): VaultEntry | null {
  if (raw === null || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const name = typeof obj.name === 'string' ? obj.name : null;
  const path = typeof obj.path === 'string' ? obj.path : null;
  const kindRaw = obj.kind;
  const created = typeof obj.created === 'string' ? obj.created : null;
  if (!name || !path || !isValidKind(kindRaw) || !created) return null;
  const entry: VaultEntry = { name, path, kind: kindRaw, created };
  if (typeof obj.description === 'string') entry.description = obj.description;
  return entry;
}

function coerceWorkspace(raw: ParsedYaml): Workspace {
  const def = raw.default;
  const vaultsRaw = raw.vaults;
  const vaults: VaultEntry[] = [];
  if (Array.isArray(vaultsRaw)) {
    for (const item of vaultsRaw) {
      const entry = coerceVaultEntry(item);
      if (entry) vaults.push(entry);
    }
  }
  return {
    default: typeof def === 'string' ? def : null,
    vaults,
  };
}

function coerceUserConfig(raw: ParsedYaml): UserConfig {
  const cfg: UserConfig = {};
  if (typeof raw.user === 'string') cfg.user = raw.user;
  const dp = raw.defaultProvider;
  if (dp === 'anthropic' || dp === 'openai' || dp === 'google') {
    cfg.defaultProvider = dp;
  }
  return cfg;
}

export function loadWorkspace(): Workspace {
  ensureUniverseDir();
  const path = workspaceYamlPath();
  if (!existsSync(path)) {
    const empty: Workspace = { default: null, vaults: [] };
    writeFileSync(path, serializeWorkspace(empty), 'utf-8');
    return empty;
  }
  try {
    const text = readFileSync(path, 'utf-8');
    return coerceWorkspace(parseYaml(text));
  } catch {
    return { default: null, vaults: [] };
  }
}

export function saveWorkspace(ws: Workspace): void {
  ensureUniverseDir();
  writeFileSync(workspaceYamlPath(), serializeWorkspace(ws), 'utf-8');
}

export function loadUserConfig(): UserConfig {
  ensureUniverseDir();
  const path = userConfigYamlPath();
  if (!existsSync(path)) return {};
  try {
    const text = readFileSync(path, 'utf-8');
    return coerceUserConfig(parseYaml(text));
  } catch {
    return {};
  }
}

export function saveUserConfig(cfg: UserConfig): void {
  ensureUniverseDir();
  writeFileSync(userConfigYamlPath(), serializeUserConfig(cfg), 'utf-8');
}

export function findVault(ws: Workspace, name: string): VaultEntry | null {
  return ws.vaults.find(v => v.name === name) ?? null;
}

export function addVault(ws: Workspace, entry: Omit<VaultEntry, 'created'>): Workspace {
  if (!isValidVaultName(entry.name)) {
    throw new Error(`Invalid vault name "${entry.name}". Use lowercase letters, digits, and hyphens (1-60 chars, no leading/trailing hyphen).`);
  }
  if (!isAbsolute(entry.path)) {
    throw new Error(`Vault path must be absolute: ${entry.path}`);
  }
  if (findVault(ws, entry.name)) {
    throw new Error(`A vault named "${entry.name}" already exists.`);
  }
  const newEntry: VaultEntry = {
    name: entry.name,
    path: entry.path,
    kind: entry.kind,
    created: new Date().toISOString(),
  };
  if (entry.description !== undefined) newEntry.description = entry.description;
  return {
    default: ws.default,
    vaults: [...ws.vaults, newEntry],
  };
}

export function removeVault(ws: Workspace, name: string): Workspace {
  const exists = findVault(ws, name);
  if (!exists) {
    throw new Error(`No vault named "${name}" found.`);
  }
  const vaults = ws.vaults.filter(v => v.name !== name);
  const def = ws.default === name ? null : ws.default;
  return { default: def, vaults };
}

export function setDefaultVault(ws: Workspace, name: string): Workspace {
  if (!findVault(ws, name)) {
    throw new Error(`No vault named "${name}" found.`);
  }
  return { default: name, vaults: ws.vaults };
}

export function resolveVaultForCommand(opts: {
  vault?: string;
  in?: string;
}): { name: string | null; path: string } {
  if (opts.vault) {
    const p = isAbsolute(opts.vault) ? opts.vault : resolve(opts.vault);
    return { name: null, path: p };
  }

  if (opts.in) {
    const ws = loadWorkspace();
    const entry = findVault(ws, opts.in);
    if (!entry) {
      throw new Error(`No vault named "${opts.in}" in workspace. Run "obs workspace list" to see registered vaults.`);
    }
    return { name: entry.name, path: entry.path };
  }

  const envPath = process.env.OBS_VAULT;
  if (envPath && envPath.length > 0) {
    if (!isAbsolute(envPath)) {
      throw new Error(`OBS_VAULT must be an absolute path: ${envPath}`);
    }
    return { name: null, path: envPath };
  }

  const ws = loadWorkspace();
  if (ws.default) {
    const entry = findVault(ws, ws.default);
    if (entry) return { name: entry.name, path: entry.path };
  }

  if (ws.vaults.length === 1) {
    const only = ws.vaults[0];
    return { name: only.name, path: only.path };
  }

  try {
    const legacy = getVaultPath();
    return { name: null, path: legacy };
  } catch {
    throw new Error(
      `No vault specified and no default configured.

To get started:
  obs workspace add <path> --default
  obs workspace use <name>

Or pass one explicitly:
  obs --vault /path/to/vault <command>
  obs <command> --in <name>`
    );
  }
}
