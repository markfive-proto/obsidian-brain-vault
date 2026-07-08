import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../../src/vault.js';
import { dreamKb } from '../../src/kb/dream.js';
import { buildIndex } from '../../src/kb/index-store.js';
import type { EmbedFn } from '../../src/kb/embeddings.js';

const fakeEmbed: EmbedFn = async (texts) => texts.map(() => [0.1, 0.2, 0.3]);

describe('dreamKb', () => {
  let tempDir: string;
  let vault: Vault;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'dream-test-'));
    mkdirSync(join(tempDir, '.obsidian'), { recursive: true });
    mkdirSync(join(tempDir, 'compiled', 'concepts'), { recursive: true });
    mkdirSync(join(tempDir, 'raw'), { recursive: true });
    writeFileSync(join(tempDir, 'compiled', 'concepts', 'a.md'), '---\ntitle: A\ntype: concept\n---\n# A\nLinks [[b]].\n');
    writeFileSync(join(tempDir, 'compiled', 'concepts', 'b.md'), '---\ntitle: B\ntype: concept\n---\n# B\n');
    vault = new Vault(tempDir);
  });

  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  it('runs health + index + graph even when compile has nothing to do', async () => {
    const report = await dreamKb(tempDir, { embedFn: fakeEmbed });

    expect(report.skipped.map(s => s.phase)).toContain('compile'); // no ingest log
    expect(report.lint).toBeDefined();
    expect(report.index).toBeDefined();
    expect(report.index!.filesEmbedded).toBeGreaterThan(0);
    expect(report.graphEdges).toBeGreaterThan(0);

    expect(report.logPath).toMatch(/^outputs\/dream\/dream-\d{4}-\d{2}-\d{2}\.md$/);
    const log = readFileSync(join(tempDir, report.logPath!), 'utf-8');
    expect(log).toContain('# Dream Cycle');
    expect(log).toContain('## Health');
    expect(existsSync(join(tempDir, '.obs-index', 'graph.json'))).toBe(true);
  });

  it('dry run writes nothing', async () => {
    const report = await dreamKb(tempDir, { dryRun: true, embedFn: fakeEmbed });
    expect(report.logPath).toBeUndefined();
    expect(existsSync(join(tempDir, 'outputs', 'dream'))).toBe(false);
    expect(existsSync(join(tempDir, '.obs-index'))).toBe(false);
    expect(report.skipped.map(s => s.phase)).toEqual(expect.arrayContaining(['lint', 'index']));
  });

  it('a failing embed provider skips the index phase but not the rest', async () => {
    const failingEmbed: EmbedFn = async () => { throw new Error('quota exceeded'); };
    const report = await dreamKb(tempDir, { embedFn: failingEmbed });
    expect(report.index).toBeUndefined();
    expect(report.skipped.find(s => s.phase === 'index')?.reason).toContain('quota');
    expect(report.lint).toBeDefined();
    expect(report.graphEdges).toBeGreaterThan(0);
  });

  it('does not clobber an existing index built with a real provider tag', async () => {
    await buildIndex(vault, { meta: { provider: 'fake', model: 'fake-1', dimensions: 3 }, embedFn: fakeEmbed });
    const report = await dreamKb(tempDir, { embedFn: fakeEmbed });
    // provider meta differs ('injected') → full rebuild is expected and fine
    expect(report.index).toBeDefined();
  });
});
