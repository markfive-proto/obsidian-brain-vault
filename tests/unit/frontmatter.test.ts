import { describe, it, expect } from 'vitest';
import { parseFrontmatter, serializeFrontmatter, updateFrontmatter } from '../../src/utils/frontmatter.js';

describe('parseFrontmatter', () => {
  it('parses frontmatter from markdown with YAML header', () => {
    const raw = `---
title: Hello
tags:
  - one
  - two
---
Body content here.`;
    const result = parseFrontmatter(raw);
    expect(result.data).toEqual({ title: 'Hello', tags: ['one', 'two'] });
    expect(result.body).toContain('Body content here.');
  });

  it('returns empty data when no frontmatter is present', () => {
    const raw = 'Just some plain markdown.';
    const result = parseFrontmatter(raw);
    expect(result.data).toEqual({});
    expect(result.body).toBe('Just some plain markdown.');
  });

  it('handles an empty string', () => {
    const result = parseFrontmatter('');
    expect(result.data).toEqual({});
    expect(result.body).toBe('');
  });
});

describe('serializeFrontmatter', () => {
  it('serializes data and body into frontmatter markdown', () => {
    const data = { title: 'Test', draft: true };
    const body = '\nSome content.';
    const result = serializeFrontmatter(data, body);
    expect(result).toContain('---');
    expect(result).toContain('title: Test');
    expect(result).toContain('draft: true');
    expect(result).toContain('Some content.');
  });

  it('returns only the body when data is empty', () => {
    const result = serializeFrontmatter({}, '\nJust body.');
    expect(result).toBe('Just body.');
    expect(result).not.toContain('---');
  });
});

describe('updateFrontmatter', () => {
  const raw = `---
title: Original
status: draft
---
Content here.`;

  it('merges new keys into existing frontmatter', () => {
    const result = updateFrontmatter(raw, { author: 'Alice' });
    const parsed = parseFrontmatter(result);
    expect(parsed.data.title).toBe('Original');
    expect(parsed.data.author).toBe('Alice');
  });

  it('overwrites existing keys', () => {
    const result = updateFrontmatter(raw, { title: 'Updated' });
    const parsed = parseFrontmatter(result);
    expect(parsed.data.title).toBe('Updated');
  });

  it('removes keys set to undefined', () => {
    const result = updateFrontmatter(raw, { status: undefined });
    const parsed = parseFrontmatter(result);
    expect(parsed.data.status).toBeUndefined();
    expect(parsed.data.title).toBe('Original');
  });
});
