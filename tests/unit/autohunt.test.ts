import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectOpenQuestions,
  buildSearchQueries,
  extractOpenQuestionsSection,
  parseDuckDuckGoResults,
  unwrapDuckDuckGoRedirect,
  dedupeUrls,
} from '../../src/kb/autohunt.js';

describe('extractOpenQuestionsSection', () => {
  it('pulls bullets from a simple Open questions block', () => {
    const md = `# Foo\n\n## Open questions\n- Why does X happen?\n- Is Y better than Z?\n\n## Sources\n- [[a]]\n`;
    expect(extractOpenQuestionsSection(md)).toEqual([
      'Why does X happen?',
      'Is Y better than Z?',
    ]);
  });

  it('returns [] when there is no Open questions section', () => {
    const md = `# Foo\n\n## TL;DR\nThe thing.\n\n## Sources\n- [[a]]\n`;
    expect(extractOpenQuestionsSection(md)).toEqual([]);
  });

  it('terminates at the next ## heading', () => {
    const md = `## Open questions\n- first\n- second\n\n## Next section\n- should not appear\n`;
    expect(extractOpenQuestionsSection(md)).toEqual(['first', 'second']);
  });

  it('runs to end-of-file when no trailing heading exists', () => {
    const md = `## Open questions\n- only\n- two\n`;
    expect(extractOpenQuestionsSection(md)).toEqual(['only', 'two']);
  });

  it('ignores nested bullets and accepts *, + as bullet markers', () => {
    const md = `## Open questions\n- top one\n  - nested ignored\n* star bullet\n+ plus bullet\n`;
    expect(extractOpenQuestionsSection(md)).toEqual(['top one', 'star bullet', 'plus bullet']);
  });

  it('is case-insensitive on the heading', () => {
    const md = `## open questions\n- lowercase heading works\n`;
    expect(extractOpenQuestionsSection(md)).toEqual(['lowercase heading works']);
  });
});

describe('collectOpenQuestions', () => {
  let vault: string;

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), 'autohunt-collect-'));
    mkdirSync(join(vault, 'compiled', 'concepts'), { recursive: true });
    mkdirSync(join(vault, 'compiled', 'people'), { recursive: true });
  });

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true });
  });

  it('returns [] when compiled/ is missing', () => {
    const empty = mkdtempSync(join(tmpdir(), 'autohunt-empty-'));
    try {
      expect(collectOpenQuestions(empty)).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('collects across concepts + people, tagging each with its concept basename', () => {
    writeFileSync(
      join(vault, 'compiled', 'concepts', 'attention.md'),
      `# Attention\n## Open questions\n- Why softmax?\n- Does scaling matter?\n\n## Sources\n- [[a]]\n`,
    );
    writeFileSync(
      join(vault, 'compiled', 'people', 'hinton.md'),
      `# Hinton\n## Open questions\n- When did capsule nets peak?\n`,
    );
    writeFileSync(
      join(vault, 'compiled', 'concepts', 'no-questions.md'),
      `# No\n## TL;DR\nnothing\n`,
    );

    const got = collectOpenQuestions(vault);
    expect(got).toHaveLength(3);
    const byConcept = got.reduce<Record<string, string[]>>((acc, q) => {
      (acc[q.concept] ??= []).push(q.question);
      return acc;
    }, {});
    expect(byConcept['attention']).toEqual(['Why softmax?', 'Does scaling matter?']);
    expect(byConcept['hinton']).toEqual(['When did capsule nets peak?']);
    // relative paths should be set
    for (const q of got) {
      expect(q.sourceConceptPath.startsWith('compiled/')).toBe(true);
    }
  });
});

describe('buildSearchQueries', () => {
  it('produces 2-3 deduped queries for a sample question/concept', () => {
    const qs = buildSearchQueries('Why does softmax saturate at large dot products?', 'scaled-dot-product-attention');
    expect(qs.length).toBeGreaterThanOrEqual(2);
    expect(qs.length).toBeLessThanOrEqual(3);
    // first query is the raw question
    expect(qs[0]).toContain('softmax');
    // second query stitches concept + question-less stem
    const joined = qs.join(' | ').toLowerCase();
    expect(joined).toContain('scaled dot product attention');
    // no duplicates
    expect(new Set(qs.map(q => q.toLowerCase())).size).toBe(qs.length);
  });

  it('handles a short question without crashing', () => {
    const qs = buildSearchQueries('Why?', 'foo');
    expect(qs.length).toBeGreaterThanOrEqual(1);
    expect(qs.every(q => typeof q === 'string' && q.length > 0)).toBe(true);
  });

  it('strips leading bullet marker from the question input', () => {
    const qs = buildSearchQueries('- Is attention all you need?', 'transformers');
    expect(qs[0].startsWith('-')).toBe(false);
  });
});

describe('unwrapDuckDuckGoRedirect', () => {
  it('decodes the uddg target from a DDG /l/ redirect', () => {
    const href = '//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&rut=abc';
    expect(unwrapDuckDuckGoRedirect(href)).toBe('https://example.com/page');
  });

  it('returns direct URLs unchanged', () => {
    expect(unwrapDuckDuckGoRedirect('https://example.com/x')).toBe('https://example.com/x');
  });

  it('returns null for garbage', () => {
    expect(unwrapDuckDuckGoRedirect('')).toBeNull();
    expect(unwrapDuckDuckGoRedirect('javascript:alert(1)')).toBeNull();
  });
});

describe('parseDuckDuckGoResults', () => {
  it('pulls URLs from DDG-shaped anchor tags', () => {
    const html = `
      <div><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fone">One</a></div>
      <div><a href="https://example.com/two" class="result__a">Two</a></div>
    `;
    const got = parseDuckDuckGoResults(html);
    expect(got).toContain('https://example.com/one');
    expect(got).toContain('https://example.com/two');
  });
});

describe('dedupeUrls', () => {
  it('deduplicates and strips tracking params', () => {
    const got = dedupeUrls([
      'https://example.com/a?utm_source=x',
      'https://example.com/a',
      'https://example.com/b#frag',
      'not-a-url',
    ]);
    expect(got).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('drops junk domains', () => {
    expect(dedupeUrls(['https://pinterest.com/pin/1', 'https://example.com/x'])).toEqual([
      'https://example.com/x',
    ]);
  });
});
