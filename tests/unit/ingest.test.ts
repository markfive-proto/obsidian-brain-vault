import { describe, it, expect } from 'vitest';
import { detectSourceType, slugify } from '../../src/kb/ingest.js';

describe('detectSourceType', () => {
  it('detects github repo URLs', () => {
    expect(detectSourceType('https://github.com/markfive-proto/obsidian-brain-vault')).toBe('repo');
    expect(detectSourceType('https://github.com/kepano/defuddle')).toBe('repo');
  });

  it('detects youtube URLs as transcripts', () => {
    expect(detectSourceType('https://youtube.com/watch?v=abc')).toBe('transcript');
    expect(detectSourceType('https://www.youtube.com/watch?v=abc')).toBe('transcript');
    expect(detectSourceType('https://youtu.be/abc')).toBe('transcript');
  });

  it('detects arxiv and PDF URLs as papers', () => {
    expect(detectSourceType('https://arxiv.org/abs/2501.12345')).toBe('paper');
    expect(detectSourceType('https://example.com/paper.pdf')).toBe('paper');
    expect(detectSourceType('./local-paper.pdf')).toBe('paper');
  });

  it('detects generic URLs as articles', () => {
    expect(detectSourceType('https://karpathy.ai/some-post')).toBe('article');
    expect(detectSourceType('https://example.com/blog/x')).toBe('article');
  });

  it('detects local images and datasets', () => {
    expect(detectSourceType('./photo.png')).toBe('image');
    expect(detectSourceType('/tmp/data.csv')).toBe('dataset');
    expect(detectSourceType('./report.json')).toBe('dataset');
  });

  it('falls back to article for unknown inputs', () => {
    expect(detectSourceType('random-string')).toBe('article');
  });
});

describe('slugify', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('strips special characters', () => {
    expect(slugify("Karpathy's LLM Wiki Pattern!")).toBe('karpathys-llm-wiki-pattern');
  });

  it('collapses consecutive hyphens and spaces', () => {
    expect(slugify('  a -- b   c  ')).toBe('a-b-c');
  });

  it('truncates to the given max length', () => {
    const long = 'a'.repeat(200);
    expect(slugify(long, 20)).toHaveLength(20);
  });

  it('falls back to "untitled" on empty input', () => {
    expect(slugify('')).toBe('untitled');
    expect(slugify('   !!!   ')).toBe('untitled');
  });
});
