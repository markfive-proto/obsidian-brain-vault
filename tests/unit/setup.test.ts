import { describe, it, expect } from 'vitest';
import {
  configPathFor,
  buildJsonPatch,
  buildTomlPatch,
  buildOpenCodePatch,
  jsonEntryMatches,
  openCodeEntryMatches,
  tomlEntryMatches,
} from '../../src/setup/editors.js';

describe('configPathFor', () => {
  const HOME = '/home/alice';

  it('claude-desktop varies by platform', () => {
    expect(configPathFor('claude-desktop', HOME, 'darwin')).toBe(
      '/home/alice/Library/Application Support/Claude/claude_desktop_config.json'
    );
    expect(configPathFor('claude-desktop', HOME, 'linux')).toBe(
      '/home/alice/.config/Claude/claude_desktop_config.json'
    );
    // win32: exact APPDATA handling is env-dependent; accept fallback form
    const winPath = configPathFor('claude-desktop', HOME, 'win32');
    expect(winPath.endsWith('Claude/claude_desktop_config.json') ||
      winPath.endsWith('Claude\\claude_desktop_config.json')).toBe(true);
  });

  it('cursor + windsurf + codex + opencode are platform-agnostic', () => {
    expect(configPathFor('cursor', HOME, 'linux')).toBe(
      '/home/alice/.cursor/mcp.json'
    );
    expect(configPathFor('windsurf', HOME, 'linux')).toBe(
      '/home/alice/.codeium/windsurf/mcp_config.json'
    );
    expect(configPathFor('codex', HOME, 'linux')).toBe(
      '/home/alice/.codex/config.toml'
    );
    expect(configPathFor('opencode', HOME, 'linux')).toBe(
      '/home/alice/.config/opencode/config.json'
    );
  });
});

describe('buildJsonPatch', () => {
  it('merges into empty config', () => {
    const out = buildJsonPatch({}, 'obs', 'obs-mcp', ['--vault', '/v']);
    expect(out).toEqual({
      mcpServers: {
        obs: { command: 'obs-mcp', args: ['--vault', '/v'] },
      },
    });
  });

  it('preserves existing unrelated servers', () => {
    const existing = {
      mcpServers: { other: { command: 'x', args: [] } },
      someOtherKey: 42,
    };
    const out = buildJsonPatch(existing, 'obs', 'obs-mcp', []) as {
      mcpServers: Record<string, unknown>;
      someOtherKey: number;
    };
    expect(out.someOtherKey).toBe(42);
    expect(out.mcpServers.other).toEqual({ command: 'x', args: [] });
    expect(out.mcpServers.obs).toEqual({ command: 'obs-mcp', args: [] });
  });

  it('idempotent: matching entry detected as identical', () => {
    const base = buildJsonPatch({}, 'obs', 'obs-mcp', ['--vault', '/v']);
    expect(jsonEntryMatches(base, 'obs', 'obs-mcp', ['--vault', '/v'])).toBe(
      'identical'
    );
    expect(jsonEntryMatches(base, 'obs', 'obs-mcp', [])).toBe('different');
    expect(jsonEntryMatches({}, 'obs', 'obs-mcp', [])).toBe('missing');
  });

  it('treats non-object existing as empty', () => {
    const out = buildJsonPatch(null, 'obs', 'obs-mcp', []) as {
      mcpServers: Record<string, unknown>;
    };
    expect(out.mcpServers.obs).toBeDefined();
  });
});

describe('buildOpenCodePatch', () => {
  it('produces type:local shape with flattened command array', () => {
    const out = buildOpenCodePatch({}, 'obs', 'obs-mcp', [
      '--vault',
      '/v',
    ]) as {
      mcp: Record<string, unknown>;
    };
    expect(out.mcp.obs).toEqual({
      type: 'local',
      command: ['obs-mcp', '--vault', '/v'],
    });
  });

  it('preserves other entries under mcp', () => {
    const existing = { mcp: { other: { type: 'local', command: ['a'] } } };
    const out = buildOpenCodePatch(existing, 'obs', 'obs-mcp', []) as {
      mcp: Record<string, unknown>;
    };
    expect(out.mcp.other).toEqual({ type: 'local', command: ['a'] });
    expect(out.mcp.obs).toEqual({ type: 'local', command: ['obs-mcp'] });
  });

  it('openCodeEntryMatches detects identical/different/missing', () => {
    const base = buildOpenCodePatch({}, 'obs', 'obs-mcp', ['--vault', '/v']);
    expect(openCodeEntryMatches(base, 'obs', 'obs-mcp', ['--vault', '/v'])).toBe(
      'identical'
    );
    expect(openCodeEntryMatches(base, 'obs', 'obs-mcp', [])).toBe('different');
    expect(openCodeEntryMatches({}, 'obs', 'obs-mcp', [])).toBe('missing');
  });
});

describe('buildTomlPatch', () => {
  it('creates new file contents when input is empty', () => {
    const out = buildTomlPatch('', 'obs', 'obs-mcp', ['--vault', '/v']);
    expect(out).toBe(
      '[mcp_servers.obs]\ncommand = "obs-mcp"\nargs = ["--vault", "/v"]\n'
    );
  });

  it('appends after existing non-mcp sections', () => {
    const existing = '[general]\nfoo = "bar"\n';
    const out = buildTomlPatch(existing, 'obs', 'obs-mcp', []);
    expect(out).toContain('[general]');
    expect(out).toContain('foo = "bar"');
    expect(out).toContain('[mcp_servers.obs]');
    expect(out.indexOf('[general]')).toBeLessThan(
      out.indexOf('[mcp_servers.obs]')
    );
  });

  it('appends after the LAST [mcp_servers.*] section', () => {
    const existing =
      '[mcp_servers.alpha]\ncommand = "a"\nargs = []\n\n[other]\nk = "v"\n';
    const out = buildTomlPatch(existing, 'obs', 'obs-mcp', []);
    // alpha block preserved
    expect(out).toContain('[mcp_servers.alpha]');
    expect(out).toContain('command = "a"');
    // new obs block inserted BEFORE [other] (appended after last mcp_servers block)
    const alphaIdx = out.indexOf('[mcp_servers.alpha]');
    const obsIdx = out.indexOf('[mcp_servers.obs]');
    const otherIdx = out.indexOf('[other]');
    expect(alphaIdx).toBeLessThan(obsIdx);
    expect(obsIdx).toBeLessThan(otherIdx);
  });

  it('replaces an existing [mcp_servers.obs] block', () => {
    const existing =
      '[mcp_servers.obs]\ncommand = "old"\nargs = ["--old"]\n\n[other]\nk = "v"\n';
    const out = buildTomlPatch(existing, 'obs', 'obs-mcp', ['--vault', '/v']);
    expect(out).not.toContain('"old"');
    expect(out).toContain('command = "obs-mcp"');
    expect(out).toContain('args = ["--vault", "/v"]');
    expect(out).toContain('[other]');
  });

  it('tomlEntryMatches identical/different/missing', () => {
    const a = buildTomlPatch('', 'obs', 'obs-mcp', ['--vault', '/v']);
    expect(tomlEntryMatches(a, 'obs', 'obs-mcp', ['--vault', '/v'])).toBe(
      'identical'
    );
    expect(tomlEntryMatches(a, 'obs', 'obs-mcp', [])).toBe('different');
    expect(tomlEntryMatches('', 'obs', 'obs-mcp', [])).toBe('missing');
  });
});
