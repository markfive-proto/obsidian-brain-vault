import { describe, it, expect } from 'vitest';
import {
  normaliseTitleForDupDetection,
  detectDuplicateConcepts,
  detectNearDuplicateTags,
  isStale,
} from '../../src/kb/lint.js';

describe('normaliseTitleForDupDetection', () => {
  it('lowercases and strips punctuation', () => {
    expect(normaliseTitleForDupDetection('Transformer')).toBe(
      normaliseTitleForDupDetection('transformer'),
    );
    expect(normaliseTitleForDupDetection('Self-Attention')).toBe(
      normaliseTitleForDupDetection('selfattention'),
    );
  });

  it('collapses simple plurals', () => {
    expect(normaliseTitleForDupDetection('transformer')).toBe(
      normaliseTitleForDupDetection('transformers'),
    );
    expect(normaliseTitleForDupDetection('embedding')).toBe(
      normaliseTitleForDupDetection('embeddings'),
    );
  });

  it('collapses -ies plurals', () => {
    expect(normaliseTitleForDupDetection('category')).toBe(
      normaliseTitleForDupDetection('categories'),
    );
  });

  it('strips .md extension', () => {
    expect(normaliseTitleForDupDetection('transformer.md')).toBe(
      normaliseTitleForDupDetection('transformer'),
    );
  });

  it('does not over-merge short words', () => {
    expect(normaliseTitleForDupDetection('cat')).not.toBe(
      normaliseTitleForDupDetection('category'),
    );
  });

  it('does not strip -ss endings', () => {
    expect(normaliseTitleForDupDetection('loss')).not.toBe(
      normaliseTitleForDupDetection('lo'),
    );
  });
});

describe('detectDuplicateConcepts', () => {
  it('flags transformer / transformers', () => {
    const g = detectDuplicateConcepts(['transformer', 'transformers', 'attention']);
    expect(g).toHaveLength(1);
    expect(g[0].variants).toEqual(['transformer', 'transformers']);
    expect(g[0].canonical).toBe('transformers');
  });

  it('does not flag cat / category', () => {
    const g = detectDuplicateConcepts(['cat', 'category']);
    expect(g).toHaveLength(0);
  });

  it('flags three-way variants', () => {
    const g = detectDuplicateConcepts(['Embedding', 'embeddings', 'EMBEDDING']);
    expect(g).toHaveLength(1);
    expect(g[0].variants.length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty when all titles are unique', () => {
    expect(detectDuplicateConcepts(['attention', 'transformer', 'mlp'])).toEqual([]);
  });

  it('handles punctuation variants', () => {
    const g = detectDuplicateConcepts(['self-attention', 'Self Attention']);
    expect(g).toHaveLength(1);
  });
});

describe('detectNearDuplicateTags', () => {
  it('flags mlops / ml-ops / ml_ops', () => {
    const g = detectNearDuplicateTags({ mlops: 5, 'ml-ops': 2, ml_ops: 1 });
    expect(g).toHaveLength(1);
    expect(g[0].variants).toContain('mlops');
    expect(g[0].variants).toContain('ml-ops');
    expect(g[0].variants).toContain('ml_ops');
    expect(g[0].canonical).toBe('mlops'); // most frequent
  });

  it('picks the most frequent variant as canonical', () => {
    const g = detectNearDuplicateTags({ 'ml-ops': 10, mlops: 2 });
    expect(g[0].canonical).toBe('ml-ops');
  });

  it('returns empty when no near-duplicates', () => {
    expect(detectNearDuplicateTags({ llm: 4, rag: 2, eval: 1 })).toEqual([]);
  });

  it('tie-breaks alphabetically', () => {
    const g = detectNearDuplicateTags({ 'ml-ops': 3, mlops: 3 });
    expect(g[0].canonical).toBe('ml-ops');
  });
});

describe('isStale', () => {
  const now = new Date('2025-01-01T00:00:00Z');

  it('is stale when older than staleDays and sources < 2', () => {
    expect(isStale('2024-01-01', 0, 90, now)).toBe(true);
    expect(isStale('2024-01-01', 1, 90, now)).toBe(true);
  });

  it('is not stale when sources_count >= 2', () => {
    expect(isStale('2024-01-01', 2, 90, now)).toBe(false);
    expect(isStale('2024-01-01', 5, 90, now)).toBe(false);
  });

  it('is not stale when within the staleDays window', () => {
    expect(isStale('2024-12-15', 0, 90, now)).toBe(false);
  });

  it('returns false for missing or unparseable last_updated', () => {
    expect(isStale(undefined, 0, 90, now)).toBe(false);
    expect(isStale('not-a-date', 0, 90, now)).toBe(false);
  });

  it('respects a custom staleDays threshold', () => {
    expect(isStale('2024-11-01', 0, 30, now)).toBe(true);
    expect(isStale('2024-12-20', 0, 30, now)).toBe(false);
  });

  it('uses strict greater-than at the boundary', () => {
    // Exactly 90 days before: not stale (>, not >=)
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - 90);
    expect(isStale(d.toISOString(), 0, 90, now)).toBe(false);
  });
});
