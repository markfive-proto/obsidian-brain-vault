import { describe, it, expect } from 'vitest';
import {
  extractClaims,
  renderVerifyCallout,
  extractWikilinks,
  annotateBody,
} from '../../src/kb/verify.js';

describe('extractClaims', () => {
  it('parses bullets under ## Key claims with citations', () => {
    const body = [
      '# Attention',
      '',
      '## TL;DR',
      'Attention is all you need.',
      '',
      '## Key claims',
      '- Scaled dot-product attention outperforms additive attention — from [[2017-attention-is-all-you-need]]',
      '- Multi-head attention improves representation — from [[2017-attention-is-all-you-need]]',
      '',
      '## Sources',
      '### [[2017-attention-is-all-you-need]]',
      'details...',
    ].join('\n');

    const claims = extractClaims(body);
    expect(claims).toHaveLength(2);
    expect(claims[0].text).toContain('Scaled dot-product');
    expect(claims[0].citedSources).toEqual(['2017-attention-is-all-you-need']);
    expect(claims[0].line).toBe(6);
    expect(claims[1].line).toBe(7);
  });

  it('captures multiple wikilinks in a single claim', () => {
    const body = [
      '## Key claims',
      '- Claim with two sources — from [[src-a]] and [[src-b]]',
    ].join('\n');
    const claims = extractClaims(body);
    expect(claims).toHaveLength(1);
    expect(claims[0].citedSources).toEqual(['src-a', 'src-b']);
  });

  it('returns empty citedSources when claim has no citations', () => {
    const body = [
      '## Key claims',
      '- A bare claim with no source.',
    ].join('\n');
    const claims = extractClaims(body);
    expect(claims).toHaveLength(1);
    expect(claims[0].citedSources).toEqual([]);
  });

  it('falls back to Sources section when Key claims is missing', () => {
    const body = [
      '# Thing',
      '',
      '## Sources',
      '- fallback bullet — from [[src-x]]',
    ].join('\n');
    const claims = extractClaims(body);
    expect(claims).toHaveLength(1);
    expect(claims[0].citedSources).toEqual(['src-x']);
  });

  it('falls back to whole body when no sections exist', () => {
    const body = [
      '- lone bullet — from [[src-y]]',
      'prose line',
      '- another bullet',
    ].join('\n');
    const claims = extractClaims(body);
    expect(claims).toHaveLength(2);
    expect(claims[0].citedSources).toEqual(['src-y']);
    expect(claims[1].citedSources).toEqual([]);
  });

  it('stops at the next ## heading', () => {
    const body = [
      '## Key claims',
      '- one — from [[a]]',
      '',
      '## Open questions',
      '- not a claim',
    ].join('\n');
    const claims = extractClaims(body);
    expect(claims).toHaveLength(1);
    expect(claims[0].text).toContain('one');
  });
});

describe('renderVerifyCallout', () => {
  it('emits a verified callout', () => {
    expect(renderVerifyCallout('verified', 'Source supports it.')).toBe('> [!verified] Source supports it.');
  });

  it('emits a partial callout', () => {
    expect(renderVerifyCallout('partial', 'Touches but weak.')).toBe('> [!partial] Touches but weak.');
  });

  it('emits an unverified callout', () => {
    expect(renderVerifyCallout('unverified', 'No mention.')).toBe('> [!unverified] No mention.');
  });

  it('emits a missing-source callout with default reason when empty', () => {
    expect(renderVerifyCallout('missing-source', '')).toBe('> [!missing-source] Claim has no cited source.');
  });

  it('collapses newlines in reason to a single line', () => {
    expect(renderVerifyCallout('verified', 'line one\nline two')).toBe('> [!verified] line one line two');
  });
});

describe('extractWikilinks', () => {
  it('extracts unique basenames', () => {
    expect(extractWikilinks('see [[a]] and [[b]] and [[a]]')).toEqual(['a', 'b']);
  });

  it('strips alias suffixes', () => {
    expect(extractWikilinks('see [[page|Display]]')).toEqual(['page']);
  });

  it('strips heading anchors', () => {
    expect(extractWikilinks('see [[page#Section]]')).toEqual(['page']);
  });

  it('returns empty array when no links', () => {
    expect(extractWikilinks('no links here')).toEqual([]);
  });
});

describe('annotateBody', () => {
  it('inserts a callout after the claim line', () => {
    const body = [
      '## Key claims',
      '- claim one — from [[src]]',
      '',
    ].join('\n');
    const result = annotateBody(body, [
      { line: 1, indent: '', callout: '> [!verified] ok' },
    ]);
    const lines = result.split('\n');
    expect(lines[1]).toBe('- claim one — from [[src]]');
    expect(lines[2]).toBe('> [!verified] ok');
  });

  it('is idempotent — replaces an existing callout rather than duplicating', () => {
    const body = [
      '- claim — from [[src]]',
      '> [!unverified] old reason',
    ].join('\n');
    const result = annotateBody(body, [
      { line: 0, indent: '', callout: '> [!verified] fresh' },
    ]);
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('> [!verified] fresh');
  });

  it('preserves indentation when inserting', () => {
    const body = '  - nested claim — from [[src]]';
    const result = annotateBody(body, [
      { line: 0, indent: '  ', callout: '> [!partial] meh' },
    ]);
    expect(result).toBe('  - nested claim — from [[src]]\n  > [!partial] meh');
  });

  it('handles multiple annotations in descending line order', () => {
    const body = [
      '- a — from [[x]]',
      '- b — from [[y]]',
      '- c — from [[z]]',
    ].join('\n');
    const result = annotateBody(body, [
      { line: 0, indent: '', callout: '> [!verified] a-ok' },
      { line: 1, indent: '', callout: '> [!unverified] b-bad' },
      { line: 2, indent: '', callout: '> [!partial] c-meh' },
    ]);
    const lines = result.split('\n');
    expect(lines[0]).toBe('- a — from [[x]]');
    expect(lines[1]).toBe('> [!verified] a-ok');
    expect(lines[2]).toBe('- b — from [[y]]');
    expect(lines[3]).toBe('> [!unverified] b-bad');
    expect(lines[4]).toBe('- c — from [[z]]');
    expect(lines[5]).toBe('> [!partial] c-meh');
  });
});
