import { describe, it, expect } from 'vitest';
import {
  extractWikilinks,
  extractMarkdownLinks,
  extractInlineTags,
  extractTasks,
  resolveWikilink,
} from '../../src/utils/markdown.js';

describe('extractWikilinks', () => {
  it('extracts a basic wikilink', () => {
    const result = extractWikilinks('See [[My Note]] for details.');
    expect(result).toEqual([{ target: 'My Note', alias: undefined, heading: undefined, blockRef: undefined }]);
  });

  it('extracts a wikilink with alias', () => {
    const result = extractWikilinks('See [[Target|Display Text]].');
    expect(result).toEqual([{ target: 'Target', alias: 'Display Text', heading: undefined, blockRef: undefined }]);
  });

  it('extracts a wikilink with heading', () => {
    const result = extractWikilinks('See [[Page#Section]].');
    expect(result).toEqual([{ target: 'Page', alias: undefined, heading: 'Section', blockRef: undefined }]);
  });

  it('extracts a wikilink with block reference', () => {
    const result = extractWikilinks('See [[Page#^abc123]].');
    expect(result).toEqual([{ target: 'Page', alias: undefined, heading: undefined, blockRef: 'abc123' }]);
  });

  it('skips wikilinks inside code blocks', () => {
    const content = `Before
\`\`\`
[[InCode]]
\`\`\`
[[Outside]]`;
    const result = extractWikilinks(content);
    expect(result).toHaveLength(1);
    expect(result[0].target).toBe('Outside');
  });
});

describe('extractMarkdownLinks', () => {
  it('extracts a basic markdown link', () => {
    const result = extractMarkdownLinks('Click [here](https://example.com) now.');
    expect(result).toEqual([{ text: 'here', url: 'https://example.com' }]);
  });

  it('skips links inside code blocks', () => {
    const content = `Text
\`\`\`
[code](http://code.com)
\`\`\`
[real](http://real.com)`;
    const result = extractMarkdownLinks(content);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe('http://real.com');
  });
});

describe('extractInlineTags', () => {
  it('extracts a basic tag', () => {
    const result = extractInlineTags('This is #important stuff.');
    expect(result).toEqual(['important']);
  });

  it('extracts nested tags', () => {
    const result = extractInlineTags('Use #project/frontend for this.');
    expect(result).toEqual(['project/frontend']);
  });

  it('skips headings', () => {
    const result = extractInlineTags('## Heading\nSome #real tag.');
    expect(result).toEqual(['real']);
  });

  it('skips tags inside code blocks', () => {
    const content = `Normal #outside
\`\`\`
#inside
\`\`\``;
    const result = extractInlineTags(content);
    expect(result).toEqual(['outside']);
  });
});

describe('extractTasks', () => {
  it('extracts unchecked tasks', () => {
    const result = extractTasks('- [ ] Buy milk');
    expect(result).toEqual([{ text: 'Buy milk', done: false, line: 1 }]);
  });

  it('extracts checked tasks', () => {
    const result = extractTasks('- [x] Done item');
    expect(result).toEqual([{ text: 'Done item', done: true, line: 1 }]);
  });

  it('extracts mixed tasks with correct line numbers', () => {
    const content = `- [ ] First
- [x] Second
- [ ] Third`;
    const result = extractTasks(content);
    expect(result).toEqual([
      { text: 'First', done: false, line: 1 },
      { text: 'Second', done: true, line: 2 },
      { text: 'Third', done: false, line: 3 },
    ]);
  });

  it('skips tasks inside code blocks', () => {
    const content = `- [ ] Real task
\`\`\`
- [ ] Fake task
\`\`\``;
    const result = extractTasks(content);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Real task');
  });
});

describe('resolveWikilink', () => {
  const files = [
    'notes/Daily.md',
    'projects/My Project.md',
    'archive/old/Daily.md',
    'README.md',
  ];

  it('returns exact match', () => {
    expect(resolveWikilink('README', files)).toBe('README.md');
  });

  it('matches case-insensitively', () => {
    expect(resolveWikilink('readme', files)).toBe('README.md');
  });

  it('returns shortest path when ambiguous', () => {
    expect(resolveWikilink('daily', files)).toBe('notes/Daily.md');
  });

  it('returns null when no match', () => {
    expect(resolveWikilink('Nonexistent', files)).toBeNull();
  });
});
