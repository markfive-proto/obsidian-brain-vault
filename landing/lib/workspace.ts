/**
 * Temporary WorkspaceClient abstraction.
 *
 * Another agent is actively building the canonical `src/workspace.ts`
 * (with `loadWorkspace()`, `VaultEntry`, etc). At integration time, the
 * lead will replace the `createLocalWorkspaceClient` implementation
 * below with a thin adapter around that module. Until then this reads
 * `~/.obs/workspace.yaml` directly so the web UI can run end-to-end.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

export type VaultKind = 'project' | 'topic' | 'vault';

export interface VaultInfo {
  name: string;
  path: string;
  kind: VaultKind;
  description?: string;
  isDefault: boolean;
}

export interface WorkspaceClient {
  list(): Promise<VaultInfo[]>;
  get(name: string): Promise<VaultInfo | null>;
}

interface RawEntry {
  name?: string;
  path?: string;
  kind?: string;
  description?: string;
  default?: boolean;
}

interface RawWorkspace {
  vaults?: RawEntry[];
  default?: string;
}

function obsHome(): string {
  return process.env.OBS_HOME ?? path.join(os.homedir(), '.obs');
}

function workspacePath(): string {
  return path.join(obsHome(), 'workspace.yaml');
}

function normalizeKind(k: string | undefined): VaultKind {
  if (k === 'project' || k === 'topic' || k === 'vault') return k;
  return 'vault';
}

function expandHome(p: string): string {
  if (p.startsWith('~')) return path.join(os.homedir(), p.slice(1));
  return p;
}

function readYamlVaults(): VaultInfo[] {
  const file = workspacePath();
  if (!fs.existsSync(file)) return [];
  let parsed: RawWorkspace;
  try {
    const text = fs.readFileSync(file, 'utf8');
    parsed = (yaml.load(text) as RawWorkspace | null | undefined) ?? {};
  } catch {
    return [];
  }
  const defaultName = parsed.default;
  const entries = Array.isArray(parsed.vaults) ? parsed.vaults : [];
  const vaults: VaultInfo[] = [];
  for (const e of entries) {
    if (!e || typeof e.name !== 'string' || typeof e.path !== 'string') continue;
    const resolved = path.resolve(expandHome(e.path));
    vaults.push({
      name: e.name,
      path: resolved,
      kind: normalizeKind(e.kind),
      description: typeof e.description === 'string' ? e.description : undefined,
      isDefault: e.default === true || e.name === defaultName,
    });
  }
  return vaults;
}

function readDevVaults(): VaultInfo[] {
  const env = process.env.OBS_DEV_VAULTS;
  if (!env) return [];
  return env
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p, idx) => {
      const abs = path.resolve(expandHome(p));
      return {
        name: path.basename(abs) || `dev-${idx}`,
        path: abs,
        kind: 'vault' as VaultKind,
        description: 'Dev-mode synthetic vault (OBS_DEV_VAULTS).',
        isDefault: idx === 0,
      } satisfies VaultInfo;
    });
}

export function createWorkspaceClient(): WorkspaceClient {
  return {
    async list(): Promise<VaultInfo[]> {
      const dev = readDevVaults();
      if (dev.length > 0) return dev;
      return readYamlVaults();
    },
    async get(name: string): Promise<VaultInfo | null> {
      const all = await this.list();
      return all.find((v) => v.name === name) ?? null;
    },
  };
}
