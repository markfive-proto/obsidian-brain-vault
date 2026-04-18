import { describe, it, expect } from 'vitest';
import { pickSampleSources, computeCitationMetrics } from '../../src/kb/eval.js';

describe('pickSampleSources', () => {
  const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

  it('is deterministic for the same seed', () => {
    const a = pickSampleSources(pool, 4, 42);
    const b = pickSampleSources(pool, 4, 42);
    expect(a).toEqual(b);
  });

  it('produces different orderings for different seeds (usually)', () => {
    const a = pickSampleSources(pool, 8, 1);
    const b = pickSampleSources(pool, 8, 999);
    // With 8 items, collision probability is tiny; assert at least one differs.
    const anyDiffers = a.some((v, i) => v !== b[i]);
    expect(anyDiffers).toBe(true);
  });

  it('returns exactly n items when n <= pool size', () => {
    const out = pickSampleSources(pool, 3, 7);
    expect(out).toHaveLength(3);
    expect(new Set(out).size).toBe(3);
  });

  it('returns unique items only', () => {
    const out = pickSampleSources(pool, 8, 13);
    expect(new Set(out).size).toBe(out.length);
  });

  it('caps at pool size when n > pool length', () => {
    const out = pickSampleSources(pool, 50, 3);
    expect(out).toHaveLength(pool.length);
    expect(new Set(out)).toEqual(new Set(pool));
  });

  it('handles empty pool', () => {
    expect(pickSampleSources([], 5, 1)).toEqual([]);
  });

  it('handles n = 0', () => {
    expect(pickSampleSources(pool, 0, 1)).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const input = [...pool];
    pickSampleSources(input, 4, 99);
    expect(input).toEqual(pool);
  });
});

describe('computeCitationMetrics', () => {
  it('returns precision 1 and recall 1 on exact match', () => {
    const m = computeCitationMetrics(['x', 'y'], ['x', 'y']);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
  });

  it('returns precision 0 and recall 0 when disjoint', () => {
    const m = computeCitationMetrics(['x'], ['y']);
    expect(m.precision).toBe(0);
    expect(m.recall).toBe(0);
  });

  it('computes partial precision correctly', () => {
    // expected=[a], actual=[a,b] -> precision 0.5, recall 1
    const m = computeCitationMetrics(['a'], ['a', 'b']);
    expect(m.precision).toBe(0.5);
    expect(m.recall).toBe(1);
  });

  it('computes partial recall correctly', () => {
    // expected=[a,b], actual=[a] -> precision 1, recall 0.5
    const m = computeCitationMetrics(['a', 'b'], ['a']);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(0.5);
  });

  it('guards divide-by-zero when actual is empty (precision = 0)', () => {
    const m = computeCitationMetrics(['a'], []);
    expect(m.precision).toBe(0);
    expect(m.recall).toBe(0);
  });

  it('guards divide-by-zero when expected is empty (recall = 1)', () => {
    const m = computeCitationMetrics([], ['a']);
    expect(m.precision).toBe(0);
    expect(m.recall).toBe(1);
  });

  it('returns recall 1 when both sides empty', () => {
    const m = computeCitationMetrics([], []);
    expect(m.precision).toBe(0);
    expect(m.recall).toBe(1);
  });

  it('deduplicates repeated citations before scoring', () => {
    const m = computeCitationMetrics(['a'], ['a', 'a', 'a']);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
  });
});
