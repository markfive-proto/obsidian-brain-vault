import { describe, it, expect } from 'vitest';
import {
  detectRepoSlug,
  parseGitRemote,
  parseGitignoreIntoGlobs,
  shouldIngestPath,
} from '../../src/kb/ingest-codebase.js';

describe('parseGitRemote', () => {
  it('parses https github URLs', () => {
    expect(parseGitRemote('https://github.com/kepano/defuddle.git')).toEqual({
      host: 'github.com',
      owner: 'kepano',
      repo: 'defuddle',
    });
    expect(parseGitRemote('https://github.com/owner/repo')).toEqual({
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('parses git@ ssh github URLs', () => {
    expect(parseGitRemote('git@github.com:kepano/defuddle.git')).toEqual({
      host: 'github.com',
      owner: 'kepano',
      repo: 'defuddle',
    });
    expect(parseGitRemote('git@github.com:owner/repo')).toEqual({
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('parses https gitlab URLs', () => {
    expect(parseGitRemote('https://gitlab.com/group/project.git')).toEqual({
      host: 'gitlab.com',
      owner: 'group',
      repo: 'project',
    });
  });

  it('parses bitbucket URLs', () => {
    expect(parseGitRemote('https://bitbucket.org/team/repo.git')).toEqual({
      host: 'bitbucket.org',
      owner: 'team',
      repo: 'repo',
    });
  });

  it('returns null for bogus input', () => {
    expect(parseGitRemote('not a url')).toBeNull();
    expect(parseGitRemote('')).toBeNull();
    expect(parseGitRemote('file:///tmp/repo')).toBeNull();
  });
});

describe('detectRepoSlug', () => {
  it('uses owner-repo when a valid remote is provided', () => {
    expect(detectRepoSlug('/tmp/whatever', 'https://github.com/kepano/defuddle.git')).toBe(
      'kepano-defuddle',
    );
    expect(detectRepoSlug('/tmp/whatever', 'git@github.com:owner/repo.git')).toBe('owner-repo');
  });

  it('falls back to the directory basename when no remote', () => {
    expect(detectRepoSlug('/Users/foo/Projects/my-cool-repo')).toBe('my-cool-repo');
    expect(detectRepoSlug('/Users/foo/Projects/my-cool-repo/')).toBe('my-cool-repo');
  });

  it('falls back to the directory basename when remote is unparseable', () => {
    expect(detectRepoSlug('/Users/foo/Projects/my-cool-repo', 'file:///nope')).toBe(
      'my-cool-repo',
    );
  });
});

describe('parseGitignoreIntoGlobs', () => {
  it('strips blanks and comments', () => {
    const input = `
# ignore build output
node_modules
dist/

# local
.env
`;
    expect(parseGitignoreIntoGlobs(input)).toEqual(['node_modules', 'dist/', '.env']);
  });

  it('skips negation patterns (documented limitation)', () => {
    const input = `node_modules\n!keep-me\n*.log`;
    expect(parseGitignoreIntoGlobs(input)).toEqual(['node_modules', '*.log']);
  });

  it('returns empty for empty or comment-only input', () => {
    expect(parseGitignoreIntoGlobs('')).toEqual([]);
    expect(parseGitignoreIntoGlobs('# just comments\n\n#more')).toEqual([]);
  });
});

describe('shouldIngestPath', () => {
  it('rejects paths under vendor/build directories', () => {
    expect(shouldIngestPath('node_modules/foo/index.js', [])).toBe(false);
    expect(shouldIngestPath('dist/bundle.js', [])).toBe(false);
    expect(shouldIngestPath('.git/config', [])).toBe(false);
    expect(shouldIngestPath('target/debug/thing', [])).toBe(false);
    expect(shouldIngestPath('src/node_modules/foo', [])).toBe(false);
  });

  it('accepts ordinary docs paths', () => {
    expect(shouldIngestPath('docs/intro.md', [])).toBe(true);
    expect(shouldIngestPath('README.md', [])).toBe(true);
    expect(shouldIngestPath('plans/phase-1.md', [])).toBe(true);
  });

  it('respects a simple gitignore file glob', () => {
    const globs = parseGitignoreIntoGlobs('*.log\nsecret/\n');
    expect(shouldIngestPath('app.log', globs)).toBe(false);
    expect(shouldIngestPath('logs/app.log', globs)).toBe(false);
    expect(shouldIngestPath('secret/keys.txt', globs)).toBe(false);
    expect(shouldIngestPath('docs/README.md', globs)).toBe(true);
  });

  it('handles ** globs', () => {
    const globs = parseGitignoreIntoGlobs('docs/**/draft.md');
    expect(shouldIngestPath('docs/a/b/draft.md', globs)).toBe(false);
    expect(shouldIngestPath('docs/public.md', globs)).toBe(true);
  });
});
