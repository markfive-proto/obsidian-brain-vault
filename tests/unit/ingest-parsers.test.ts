import { describe, it, expect } from 'vitest';
import { parseArxivId } from '../../src/kb/ingest-paper.js';
import { parseGithubUrl } from '../../src/kb/ingest-repo.js';
import { parseYoutubeId, cleanVtt } from '../../src/kb/ingest-transcript.js';

describe('parseArxivId', () => {
  it('extracts id from abs URLs', () => {
    expect(parseArxivId('https://arxiv.org/abs/2501.12345')).toBe('2501.12345');
    expect(parseArxivId('http://arxiv.org/abs/2501.12345v2')).toBe('2501.12345v2');
  });

  it('extracts id from pdf URLs with or without .pdf suffix', () => {
    expect(parseArxivId('https://arxiv.org/pdf/2501.12345')).toBe('2501.12345');
    expect(parseArxivId('https://arxiv.org/pdf/2501.12345.pdf')).toBe('2501.12345');
  });

  it('returns null for non-arxiv URLs', () => {
    expect(parseArxivId('https://example.com/paper.pdf')).toBeNull();
    expect(parseArxivId('./local.pdf')).toBeNull();
  });
});

describe('parseGithubUrl', () => {
  it('parses canonical github URLs', () => {
    expect(parseGithubUrl('https://github.com/kepano/defuddle')).toEqual({
      owner: 'kepano',
      repo: 'defuddle',
    });
  });

  it('parses URLs with .git suffix', () => {
    expect(parseGithubUrl('https://github.com/owner/repo.git')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('parses URLs with trailing paths or query strings', () => {
    expect(parseGithubUrl('https://github.com/owner/repo/tree/main')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
    expect(parseGithubUrl('https://github.com/owner/repo?tab=readme')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('returns null for non-github URLs', () => {
    expect(parseGithubUrl('https://gitlab.com/owner/repo')).toBeNull();
    expect(parseGithubUrl('https://example.com')).toBeNull();
  });
});

describe('parseYoutubeId', () => {
  it('parses youtu.be short links', () => {
    expect(parseYoutubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('parses watch URLs', () => {
    expect(parseYoutubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYoutubeId('https://youtube.com/watch?v=abcdefghijk&list=PL')).toBe('abcdefghijk');
  });

  it('parses shorts/live/embed URLs', () => {
    expect(parseYoutubeId('https://youtube.com/shorts/abc123xyz9')).toBe('abc123xyz9');
    expect(parseYoutubeId('https://youtube.com/embed/abc123xyz9')).toBe('abc123xyz9');
  });

  it('returns null for non-youtube URLs', () => {
    expect(parseYoutubeId('https://vimeo.com/12345')).toBeNull();
  });
});

describe('cleanVtt', () => {
  it('strips header, timings, and duplicate rolling lines', () => {
    const vtt = `WEBVTT
Kind: captions
Language: en

00:00:00.000 --> 00:00:02.000
hello world

00:00:02.000 --> 00:00:04.000
hello world
this is a test

00:00:04.000 --> 00:00:06.000
this is a test
second sentence`;
    const cleaned = cleanVtt(vtt);
    expect(cleaned).toBe('hello world this is a test second sentence');
  });

  it('strips inline timing tags', () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
<00:00:00.500><c>hello</c> <00:00:01.000><c>world</c>`;
    expect(cleanVtt(vtt)).toBe('hello world');
  });
});
