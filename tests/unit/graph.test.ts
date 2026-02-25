import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../../src/vault.js';
import { extractWikilinks, resolveWikilink } from '../../src/utils/markdown.js';

describe('Graph traversal (BFS path finding)', () => {
  let tempDir: string;
  let vault: Vault;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'graph-test-'));
    mkdirSync(join(tempDir, '.obsidian'), { recursive: true });

    // Create a chain: a -> b -> c -> d
    writeFileSync(join(tempDir, 'a.md'), '# A\nLinks to [[b]].\n');
    writeFileSync(join(tempDir, 'b.md'), '# B\nLinks to [[c]] and [[a]].\n');
    writeFileSync(join(tempDir, 'c.md'), '# C\nLinks to [[d]].\n');
    writeFileSync(join(tempDir, 'd.md'), '# D\nNo outgoing links.\n');
    // Isolated node
    writeFileSync(join(tempDir, 'isolated.md'), '# Isolated\nNo links here.\n');

    vault = new Vault(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('finds direct path between linked notes', async () => {
    const allFiles = await vault.listFiles();
    const path = bfsPath('a.md', 'b.md', allFiles, vault);
    expect(path).toEqual(['a.md', 'b.md']);
  });

  it('finds multi-hop path', async () => {
    const allFiles = await vault.listFiles();
    const path = bfsPath('a.md', 'd.md', allFiles, vault);
    expect(path).toEqual(['a.md', 'b.md', 'c.md', 'd.md']);
  });

  it('returns null when no path exists', async () => {
    const allFiles = await vault.listFiles();
    const path = bfsPath('a.md', 'isolated.md', allFiles, vault);
    expect(path).toBeNull();
  });

  it('returns single-element path for same start and end', async () => {
    const allFiles = await vault.listFiles();
    const path = bfsPath('a.md', 'a.md', allFiles, vault);
    expect(path).toEqual(['a.md']);
  });

  it('finds shortest path when multiple paths exist', async () => {
    // Add a shortcut: a -> d directly
    writeFileSync(join(tempDir, 'a.md'), '# A\nLinks to [[b]] and [[d]].\n');
    const allFiles = await vault.listFiles();
    const path = bfsPath('a.md', 'd.md', allFiles, vault);
    expect(path).toEqual(['a.md', 'd.md']);
  });
});

describe('Orphan detection', () => {
  let tempDir: string;
  let vault: Vault;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orphan-test-'));
    mkdirSync(join(tempDir, '.obsidian'), { recursive: true });

    writeFileSync(join(tempDir, 'hub.md'), '# Hub\nLinks to [[spoke1]] and [[spoke2]].\n');
    writeFileSync(join(tempDir, 'spoke1.md'), '# Spoke 1\nLinked from hub.\n');
    writeFileSync(join(tempDir, 'spoke2.md'), '# Spoke 2\nLinks to [[spoke1]].\n');
    writeFileSync(join(tempDir, 'orphan.md'), '# Orphan\nNobody links here.\n');

    vault = new Vault(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('identifies orphan notes with zero backlinks', async () => {
    const allFiles = await vault.listFiles();
    const linkedTo = new Set<string>();

    for (const file of allFiles) {
      const raw = vault.readFileRaw(file);
      for (const link of extractWikilinks(raw)) {
        const resolved = resolveWikilink(link.target, allFiles);
        if (resolved) linkedTo.add(resolved);
      }
    }

    const orphans = allFiles.filter(f => !linkedTo.has(f));
    expect(orphans).toContain('orphan.md');
    expect(orphans).toContain('hub.md'); // hub links out but nothing links to it
    expect(orphans).not.toContain('spoke1.md'); // linked by hub and spoke2
    expect(orphans).not.toContain('spoke2.md'); // linked by hub
  });
});

// Shared BFS implementation for testing (mirrors the CLI logic)
function bfsPath(start: string, end: string, allFiles: string[], vault: Vault): string[] | null {
  const adj = new Map<string, string[]>();
  for (const file of allFiles) {
    try {
      const raw = vault.readFileRaw(file);
      const wikilinks = extractWikilinks(raw);
      const neighbors: string[] = [];
      for (const link of wikilinks) {
        const resolved = resolveWikilink(link.target, allFiles);
        if (resolved && resolved !== file) neighbors.push(resolved);
      }
      adj.set(file, neighbors);
    } catch { /* skip */ }
  }

  const queue: string[][] = [[start]];
  const visited = new Set<string>([start]);

  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path[path.length - 1];
    if (current === end) return path;
    for (const neighbor of (adj.get(current) ?? [])) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push([...path, neighbor]);
      }
    }
  }

  return null;
}
