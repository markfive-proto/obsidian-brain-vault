import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../../src/vault.js';
import { chunkNote, vecToBase64, base64ToVec, contentHash, buildIndex, loadIndex, indexPath } from '../../src/kb/index-store.js';
import { hybridSearch, bm25Rank, rrfFusion, tierBoost, cosineSimilarity } from '../../src/kb/hybrid-search.js';
import type { EmbedFn } from '../../src/kb/embeddings.js';

/** Deterministic fake embeddings: axis per keyword, no network. */
const KEYWORDS = ['pricing', 'agents', 'obsidian', 'coffee'];
const fakeEmbed: EmbedFn = async (texts) =>
  texts.map(t => {
    const lower = t.toLowerCase();
    const vec = KEYWORDS.map(k => (lower.includes(k) ? 1 : 0.01));
    return vec;
  });

const META = { provider: 'fake', model: 'fake-1', dimensions: 4 };

describe('chunkNote', () => {
  it('drops frontmatter and splits by headings', () => {
    const raw = `---\ntitle: X\n---\nIntro paragraph.\n\n## Section A\nContent A.\n\n## Section B\nContent B.\n`;
    const chunks = chunkNote(raw);
    expect(chunks.map(c => c.heading)).toEqual(['', 'Section A', 'Section B']);
    expect(chunks[0].text).toBe('Intro paragraph.');
    expect(chunks[0].text).not.toContain('title');
  });

  it('splits oversized sections on paragraph boundaries', () => {
    const para = 'word '.repeat(120).trim();          // ~600 chars
    const raw = `## Big\n${para}\n\n${para}\n\n${para}\n\n${para}\n`;
    const chunks = chunkNote(raw);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.heading).toBe('Big');
      expect(c.text.length).toBeLessThanOrEqual(1500);
    }
  });

  it('hard-splits a single paragraph longer than the cap', () => {
    const raw = `## Huge\n${'x'.repeat(4000)}\n`;
    const chunks = chunkNote(raw);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
  });
});

describe('vector serialization', () => {
  it('round-trips through base64', () => {
    const vec = [0.25, -1.5, 3.75, 0];
    const decoded = base64ToVec(vecToBase64(vec));
    expect([...decoded]).toEqual(vec);
  });
});

describe('buildIndex', () => {
  let tempDir: string;
  let vault: Vault;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'index-test-'));
    mkdirSync(join(tempDir, '.obsidian'), { recursive: true });
    mkdirSync(join(tempDir, 'compiled'), { recursive: true });
    writeFileSync(join(tempDir, 'compiled', 'pricing.md'), '# Pricing\nCharge per outcome for agents, not per seat.\n');
    writeFileSync(join(tempDir, 'notes.md'), '# Notes\nObsidian vaults hold markdown.\n');
    vault = new Vault(tempDir);
  });

  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  it('builds, then skips unchanged files on rebuild', async () => {
    const first = await buildIndex(vault, { meta: META, embedFn: fakeEmbed });
    expect(first.filesEmbedded).toBe(2);
    expect(existsSync(indexPath(tempDir))).toBe(true);

    const second = await buildIndex(vault, { meta: META, embedFn: fakeEmbed });
    expect(second.filesEmbedded).toBe(0);
    expect(second.filesUnchanged).toBe(2);
  });

  it('re-embeds only changed files', async () => {
    await buildIndex(vault, { meta: META, embedFn: fakeEmbed });
    writeFileSync(join(tempDir, 'notes.md'), '# Notes\nNow about coffee brewing.\n');
    const report = await buildIndex(vault, { meta: META, embedFn: fakeEmbed });
    expect(report.filesEmbedded).toBe(1);
    expect(report.filesUnchanged).toBe(1);
  });

  it('drops deleted files and forces rebuild on model change', async () => {
    await buildIndex(vault, { meta: META, embedFn: fakeEmbed });
    rmSync(join(tempDir, 'notes.md'));
    const report = await buildIndex(vault, { meta: META, embedFn: fakeEmbed });
    expect(report.filesRemoved).toBe(1);
    expect(Object.keys(loadIndex(tempDir)!.files)).toEqual(['compiled/pricing.md']);

    const changed = await buildIndex(vault, { meta: { ...META, model: 'fake-2' }, embedFn: fakeEmbed });
    expect(changed.filesEmbedded).toBe(1); // full re-embed despite unchanged content
  });

  it('contentHash is stable and content-sensitive', () => {
    expect(contentHash('abc')).toBe(contentHash('abc'));
    expect(contentHash('abc')).not.toBe(contentHash('abd'));
  });
});

describe('hybridSearch', () => {
  let tempDir: string;
  let vault: Vault;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'hybrid-test-'));
    mkdirSync(join(tempDir, '.obsidian'), { recursive: true });
    mkdirSync(join(tempDir, 'compiled'), { recursive: true });
    mkdirSync(join(tempDir, 'outputs'), { recursive: true });
    writeFileSync(join(tempDir, 'compiled', 'agent-pricing.md'), '# Agent pricing\nCharge per outcome for agents, not per seat. Pricing matters.\n');
    writeFileSync(join(tempDir, 'outputs', 'agent-pricing-copy.md'), '# Agent pricing copy\nCharge per outcome for agents, not per seat. Pricing matters.\n');
    writeFileSync(join(tempDir, 'coffee.md'), '# Coffee\nHow to brew coffee with a V60.\n');
    vault = new Vault(tempDir);
    await buildIndex(vault, { meta: META, embedFn: fakeEmbed });
  });

  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  it('hybrid mode fuses keyword + vector and tier-boosts compiled/ over outputs/', async () => {
    const report = await hybridSearch(vault, 'pricing agents', { mode: 'hybrid', embedFn: fakeEmbed, k: 5 });
    expect(report.effectiveMode).toBe('hybrid');
    expect(report.warning).toBeUndefined();
    expect(report.results.length).toBeGreaterThan(0);
    expect(report.results[0].path).toBe('compiled/agent-pricing.md');
    const copy = report.results.find(r => r.path === 'outputs/agent-pricing-copy.md');
    expect(copy).toBeDefined();
    expect(copy!.score).toBeLessThan(report.results[0].score);
  });

  it('semantic mode ranks by meaning', async () => {
    const report = await hybridSearch(vault, 'coffee', { mode: 'semantic', embedFn: fakeEmbed, k: 3 });
    expect(report.effectiveMode).toBe('semantic');
    expect(report.results[0].path).toBe('coffee.md');
  });

  it('falls back to keyword with a warning when the index is missing', async () => {
    rmSync(join(tempDir, '.obs-index'), { recursive: true, force: true });
    const report = await hybridSearch(vault, 'coffee brew', { mode: 'hybrid', embedFn: fakeEmbed, k: 3 });
    expect(report.effectiveMode).toBe('keyword');
    expect(report.warning).toContain('obs kb index');
    expect(report.results[0].path).toBe('coffee.md');
  });

  it('keyword mode works with no index and no embeddings', async () => {
    rmSync(join(tempDir, '.obs-index'), { recursive: true, force: true });
    const report = await hybridSearch(vault, 'outcome seat', { mode: 'keyword', k: 3 });
    expect(report.results.some(r => r.path.includes('agent-pricing'))).toBe(true);
  });
});

describe('ranking primitives', () => {
  const mkChunk = (path: string, text: string, vec?: number[]) => ({
    path,
    chunkId: `${path}#0`,
    heading: '',
    text,
    vec: vec ? new Float32Array(vec) : null,
  });

  it('bm25 ranks rarer term matches higher', () => {
    const chunks = [
      mkChunk('a.md', 'pricing pricing pricing common word'),
      mkChunk('b.md', 'common word only here'),
      mkChunk('c.md', 'nothing relevant at all'),
    ];
    const ranked = bm25Rank(chunks, 'pricing', 10);
    expect(ranked[0].path).toBe('a.md');
    expect(ranked.map(c => c.path)).not.toContain('c.md');
  });

  it('rrfFusion rewards items present in multiple lists', () => {
    const a = mkChunk('compiled/a.md', 'x');
    const b = mkChunk('raw/b.md', 'y');
    const c = mkChunk('raw/c.md', 'z');
    const fused = rrfFusion([[a, b], [b, c]]);
    // b appears in both lists → highest fused score
    expect(fused[0].chunk.path).toBe('raw/b.md');
    expect(fused[0].score).toBe(1);
    expect(fused.map(f => f.chunk.path)).toContain('compiled/a.md');
  });

  it('tierBoost prefers compiled, demotes outputs', () => {
    expect(tierBoost('compiled/x.md')).toBeGreaterThan(tierBoost('raw/x.md'));
    expect(tierBoost('outputs/x.md')).toBeLessThan(tierBoost('raw/x.md'));
  });

  it('bm25 tier boost reorders equally relevant hits, not clearly better ones', () => {
    const chunks = [
      mkChunk('outputs/same.md', 'pricing outcome model'),
      mkChunk('compiled/same.md', 'pricing outcome model'),
      mkChunk('raw/strong.md', 'pricing pricing pricing outcome outcome model'),
    ];
    const ranked = bm25Rank(chunks, 'pricing outcome', 10);
    // identical text: compiled beats outputs
    expect(ranked.map(c => c.path).indexOf('compiled/same.md'))
      .toBeLessThan(ranked.map(c => c.path).indexOf('outputs/same.md'));
    // a much stronger raw hit still beats the boosted compiled one
    expect(ranked[0].path).toBe('raw/strong.md');
  });

  it('cosineSimilarity handles zero vectors and orthogonality', () => {
    expect(cosineSimilarity(new Float32Array([0, 0]), new Float32Array([1, 1]))).toBe(0);
    expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBe(0);
    expect(cosineSimilarity(new Float32Array([1, 2]), new Float32Array([1, 2]))).toBeCloseTo(1);
  });
});
