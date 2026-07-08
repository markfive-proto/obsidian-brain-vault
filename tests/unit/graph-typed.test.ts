import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../../src/vault.js';
import { extractTypedEdges, traverseGraph } from '../../src/kb/graph.js';

describe('Typed-edge graph', () => {
  let tempDir: string;
  let vault: Vault;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'graph-typed-'));
    mkdirSync(join(tempDir, '.obsidian'), { recursive: true });
    mkdirSync(join(tempDir, 'compiled', 'people'), { recursive: true });
    mkdirSync(join(tempDir, 'compiled', 'orgs'), { recursive: true });
    mkdirSync(join(tempDir, 'compiled', 'concepts'), { recursive: true });

    writeFileSync(join(tempDir, 'compiled', 'people', 'garry-tan.md'), [
      '---',
      'title: Garry Tan',
      'type: person',
      'org: "[[y-combinator]]"',
      'founded: ["[[initialized-capital]]"]',
      '---',
      '# Garry Tan',
      'Built [[gbrain]].',
    ].join('\n'));

    writeFileSync(join(tempDir, 'compiled', 'orgs', 'y-combinator.md'), [
      '---',
      'title: Y Combinator',
      'type: org',
      '---',
      '# Y Combinator',
    ].join('\n'));

    writeFileSync(join(tempDir, 'compiled', 'orgs', 'initialized-capital.md'), [
      '---',
      'title: Initialized Capital',
      'type: org',
      'founders: ["[[garry-tan]]"]',
      '---',
      '# Initialized Capital',
    ].join('\n'));

    writeFileSync(join(tempDir, 'compiled', 'concepts', 'gbrain.md'), [
      '---',
      'title: GBrain',
      'type: concept',
      'related: ["[[second-brain]]", "[[missing-note]]"]',
      '---',
      '# GBrain',
      'See https://github.com/garrytan/gbrain for source.',
    ].join('\n'));

    writeFileSync(join(tempDir, 'compiled', 'concepts', 'second-brain.md'), [
      '---',
      'title: Second Brain',
      'type: concept',
      '---',
      '# Second Brain',
    ].join('\n'));

    vault = new Vault(tempDir);
  });

  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  it('extracts works_at from a person org field', async () => {
    const { edges } = await extractTypedEdges(vault);
    expect(edges).toContainEqual(expect.objectContaining({
      from: 'compiled/people/garry-tan.md',
      to: 'compiled/orgs/y-combinator.md',
      type: 'works_at',
      source: 'frontmatter',
    }));
  });

  it('extracts founded edges, including reversed founders fields', async () => {
    const { edges } = await extractTypedEdges(vault);
    const founded = edges.filter(e => e.type === 'founded');
    // both the person's `founded:` and the org's `founders:` collapse into
    // one deduped person→org edge
    expect(founded).toHaveLength(1);
    expect(founded[0].from).toBe('compiled/people/garry-tan.md');
    expect(founded[0].to).toBe('compiled/orgs/initialized-capital.md');
  });

  it('extracts related_to and skips unresolvable + external targets', async () => {
    const { edges } = await extractTypedEdges(vault);
    expect(edges).toContainEqual(expect.objectContaining({
      from: 'compiled/concepts/gbrain.md',
      to: 'compiled/concepts/second-brain.md',
      type: 'related_to',
    }));
    expect(edges.some(e => e.to.includes('missing-note'))).toBe(false);
    expect(edges.some(e => e.to.includes('github.com'))).toBe(false);
  });

  it('turns body wikilinks into mentions edges', async () => {
    const { edges } = await extractTypedEdges(vault);
    expect(edges).toContainEqual(expect.objectContaining({
      from: 'compiled/people/garry-tan.md',
      to: 'compiled/concepts/gbrain.md',
      type: 'mentions',
      source: 'wikilink',
    }));
  });

  it('traverses multi-hop with edge chains', async () => {
    const result = await traverseGraph(vault, 'garry-tan', { depth: 2 });
    const paths = result.hits.map(h => h.path);
    expect(paths).toContain('compiled/orgs/y-combinator.md');       // 1 hop
    expect(paths).toContain('compiled/concepts/gbrain.md');          // 1 hop
    expect(paths).toContain('compiled/concepts/second-brain.md');    // 2 hops via gbrain
    const sb = result.hits.find(h => h.path.endsWith('second-brain.md'))!;
    expect(sb.distance).toBe(2);
    expect(sb.via).toHaveLength(2);
  });

  it('filters traversal by edge type and direction', async () => {
    const onlyWork = await traverseGraph(vault, 'garry-tan', { types: ['works_at'] });
    expect(onlyWork.hits.map(h => h.path)).toEqual(['compiled/orgs/y-combinator.md']);

    const incoming = await traverseGraph(vault, 'y-combinator', { direction: 'in', depth: 1 });
    expect(incoming.hits.map(h => h.path)).toContain('compiled/people/garry-tan.md');
  });
});
