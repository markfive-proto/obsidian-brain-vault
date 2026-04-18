import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isValidVaultName,
  addVault,
  removeVault,
  findVault,
  setDefaultVault,
  loadWorkspace,
  saveWorkspace,
  resolveVaultForCommand,
  universeDir,
  workspaceYamlPath,
  type Workspace,
} from '../../src/workspace.js';

let tmpHome: string;
let tmpFakeHome: string;
const savedHome = process.env.OBS_HOME;
const savedVault = process.env.OBS_VAULT;
const savedRealHome = process.env.HOME;

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'obs-ws-'));
  tmpFakeHome = mkdtempSync(join(tmpdir(), 'obs-fakehome-'));
  process.env.OBS_HOME = tmpHome;
  process.env.HOME = tmpFakeHome;
  delete process.env.OBS_VAULT;
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  rmSync(tmpFakeHome, { recursive: true, force: true });
  if (savedHome === undefined) delete process.env.OBS_HOME;
  else process.env.OBS_HOME = savedHome;
  if (savedVault === undefined) delete process.env.OBS_VAULT;
  else process.env.OBS_VAULT = savedVault;
  if (savedRealHome !== undefined) process.env.HOME = savedRealHome;
});

function mkWs(): Workspace {
  return { default: null, vaults: [] };
}

describe('isValidVaultName', () => {
  it('accepts valid slugs', () => {
    expect(isValidVaultName('a')).toBe(true);
    expect(isValidVaultName('my-project')).toBe(true);
    expect(isValidVaultName('vault-1')).toBe(true);
    expect(isValidVaultName('a1b2c3')).toBe(true);
    expect(isValidVaultName('a'.repeat(60))).toBe(true);
  });

  it('rejects invalid names', () => {
    expect(isValidVaultName('')).toBe(false);
    expect(isValidVaultName('-leading')).toBe(false);
    expect(isValidVaultName('trailing-')).toBe(false);
    expect(isValidVaultName('Upper')).toBe(false);
    expect(isValidVaultName('has space')).toBe(false);
    expect(isValidVaultName('dots.name')).toBe(false);
    expect(isValidVaultName('under_score')).toBe(false);
    expect(isValidVaultName('a'.repeat(61))).toBe(false);
  });
});

describe('addVault', () => {
  it('appends entry and sets created timestamp', () => {
    const before = Date.now();
    const ws = addVault(mkWs(), {
      name: 'alpha',
      path: '/abs/alpha',
      kind: 'project',
    });
    const after = Date.now();
    expect(ws.vaults).toHaveLength(1);
    const entry = ws.vaults[0];
    expect(entry.name).toBe('alpha');
    expect(entry.path).toBe('/abs/alpha');
    expect(entry.kind).toBe('project');
    const createdMs = Date.parse(entry.created);
    expect(createdMs).toBeGreaterThanOrEqual(before);
    expect(createdMs).toBeLessThanOrEqual(after);
  });

  it('preserves description when provided', () => {
    const ws = addVault(mkWs(), {
      name: 'alpha',
      path: '/abs/alpha',
      kind: 'topic',
      description: 'my notes',
    });
    expect(ws.vaults[0].description).toBe('my notes');
  });

  it('rejects duplicate names', () => {
    const ws = addVault(mkWs(), { name: 'alpha', path: '/abs/a', kind: 'project' });
    expect(() =>
      addVault(ws, { name: 'alpha', path: '/abs/b', kind: 'project' }),
    ).toThrow(/already exists/);
  });

  it('rejects invalid names', () => {
    expect(() =>
      addVault(mkWs(), { name: 'Bad Name', path: '/abs/x', kind: 'project' }),
    ).toThrow(/Invalid vault name/);
  });

  it('rejects non-absolute paths', () => {
    expect(() =>
      addVault(mkWs(), { name: 'alpha', path: 'relative/path', kind: 'project' }),
    ).toThrow(/absolute/);
  });

  it('does not mutate the input workspace', () => {
    const ws = mkWs();
    addVault(ws, { name: 'alpha', path: '/abs/a', kind: 'project' });
    expect(ws.vaults).toHaveLength(0);
  });
});

describe('removeVault', () => {
  it('removes an existing entry', () => {
    let ws = addVault(mkWs(), { name: 'alpha', path: '/abs/a', kind: 'project' });
    ws = addVault(ws, { name: 'beta', path: '/abs/b', kind: 'topic' });
    const after = removeVault(ws, 'alpha');
    expect(after.vaults).toHaveLength(1);
    expect(after.vaults[0].name).toBe('beta');
  });

  it('clears default when removed vault was default', () => {
    let ws = addVault(mkWs(), { name: 'alpha', path: '/abs/a', kind: 'project' });
    ws = setDefaultVault(ws, 'alpha');
    expect(ws.default).toBe('alpha');
    const after = removeVault(ws, 'alpha');
    expect(after.default).toBeNull();
  });

  it('preserves default when another vault is removed', () => {
    let ws = addVault(mkWs(), { name: 'alpha', path: '/abs/a', kind: 'project' });
    ws = addVault(ws, { name: 'beta', path: '/abs/b', kind: 'project' });
    ws = setDefaultVault(ws, 'alpha');
    const after = removeVault(ws, 'beta');
    expect(after.default).toBe('alpha');
  });

  it('throws when name not found', () => {
    expect(() => removeVault(mkWs(), 'missing')).toThrow(/No vault named/);
  });
});

describe('findVault', () => {
  it('returns entry on hit', () => {
    const ws = addVault(mkWs(), { name: 'alpha', path: '/abs/a', kind: 'project' });
    expect(findVault(ws, 'alpha')?.path).toBe('/abs/a');
  });

  it('returns null on miss', () => {
    expect(findVault(mkWs(), 'nope')).toBeNull();
  });
});

describe('setDefaultVault', () => {
  it('sets default on success', () => {
    let ws = addVault(mkWs(), { name: 'alpha', path: '/abs/a', kind: 'project' });
    ws = setDefaultVault(ws, 'alpha');
    expect(ws.default).toBe('alpha');
  });

  it('throws when vault not found', () => {
    expect(() => setDefaultVault(mkWs(), 'nope')).toThrow(/No vault named/);
  });
});

describe('universeDir + persistence', () => {
  it('respects OBS_HOME override', () => {
    expect(universeDir()).toBe(tmpHome);
    expect(workspaceYamlPath()).toBe(join(tmpHome, 'workspace.yaml'));
  });

  it('round-trips a workspace through save/load', () => {
    let ws = loadWorkspace();
    ws = addVault(ws, {
      name: 'alpha',
      path: '/abs/alpha',
      kind: 'project',
      description: 'hello world',
    });
    ws = addVault(ws, { name: 'beta', path: '/abs/beta', kind: 'topic' });
    ws = setDefaultVault(ws, 'beta');
    saveWorkspace(ws);

    const loaded = loadWorkspace();
    expect(loaded.default).toBe('beta');
    expect(loaded.vaults).toHaveLength(2);
    expect(loaded.vaults[0].name).toBe('alpha');
    expect(loaded.vaults[0].description).toBe('hello world');
    expect(loaded.vaults[1].name).toBe('beta');
    expect(loaded.vaults[1].kind).toBe('topic');
  });

  it('loadWorkspace creates empty workspace on first call', () => {
    const loaded = loadWorkspace();
    expect(loaded.default).toBeNull();
    expect(loaded.vaults).toEqual([]);
  });
});

describe('resolveVaultForCommand', () => {
  it('tier 1: --vault absolute path wins over everything', () => {
    let ws = addVault(mkWs(), { name: 'alpha', path: '/abs/alpha', kind: 'project' });
    ws = setDefaultVault(ws, 'alpha');
    saveWorkspace(ws);
    process.env.OBS_VAULT = '/env/path';

    const resolved = resolveVaultForCommand({ vault: '/explicit/path' });
    expect(resolved.path).toBe('/explicit/path');
    expect(resolved.name).toBeNull();
  });

  it('tier 2: --in name looks up workspace', () => {
    let ws = addVault(mkWs(), { name: 'alpha', path: '/abs/alpha', kind: 'project' });
    ws = addVault(ws, { name: 'beta', path: '/abs/beta', kind: 'topic' });
    saveWorkspace(ws);

    const resolved = resolveVaultForCommand({ in: 'beta' });
    expect(resolved.path).toBe('/abs/beta');
    expect(resolved.name).toBe('beta');
  });

  it('tier 2: --in name throws if not found', () => {
    saveWorkspace(mkWs());
    expect(() => resolveVaultForCommand({ in: 'missing' })).toThrow(/No vault named "missing"/);
  });

  it('tier 3: OBS_VAULT env var', () => {
    saveWorkspace(mkWs());
    process.env.OBS_VAULT = '/env/vault';
    const resolved = resolveVaultForCommand({});
    expect(resolved.path).toBe('/env/vault');
    expect(resolved.name).toBeNull();
  });

  it('tier 3: OBS_VAULT must be absolute', () => {
    saveWorkspace(mkWs());
    process.env.OBS_VAULT = 'relative';
    expect(() => resolveVaultForCommand({})).toThrow(/absolute/);
  });

  it('tier 4: workspace default', () => {
    let ws = addVault(mkWs(), { name: 'alpha', path: '/abs/alpha', kind: 'project' });
    ws = addVault(ws, { name: 'beta', path: '/abs/beta', kind: 'topic' });
    ws = setDefaultVault(ws, 'alpha');
    saveWorkspace(ws);

    const resolved = resolveVaultForCommand({});
    expect(resolved.name).toBe('alpha');
    expect(resolved.path).toBe('/abs/alpha');
  });

  it('tier 5: single-vault compatibility when no default set', () => {
    const ws = addVault(mkWs(), { name: 'only', path: '/abs/only', kind: 'vault' });
    saveWorkspace(ws);

    const resolved = resolveVaultForCommand({});
    expect(resolved.name).toBe('only');
    expect(resolved.path).toBe('/abs/only');
  });

  it('tier 6: falls back to legacy getVaultPath or throws a helpful error', () => {
    saveWorkspace(mkWs());
    try {
      const resolved = resolveVaultForCommand({});
      expect(typeof resolved.path).toBe('string');
      expect(resolved.path.length).toBeGreaterThan(0);
      expect(resolved.name).toBeNull();
    } catch (err) {
      expect((err as Error).message).toMatch(/No vault specified/);
    }
  });
});
