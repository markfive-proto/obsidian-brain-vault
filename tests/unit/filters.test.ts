import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, cpSync, rmSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../../src/vault.js';

const FIXTURE_PATH = join(__dirname, '..', 'fixtures', 'test-vault');

describe('Date-range and frontmatter filtering', () => {
  let tempDir: string;
  let vault: Vault;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'filter-test-'));
    cpSync(FIXTURE_PATH, tempDir, { recursive: true });
    vault = new Vault(tempDir);

    // Create notes with different modification dates
    writeFileSync(join(tempDir, 'recent.md'), '---\nstatus: draft\ntype: idea\n---\n\nRecent note.\n');
    writeFileSync(join(tempDir, 'old.md'), '---\nstatus: published\ntype: article\n---\n\nOld note.\n');

    // Set old.md to 60 days ago
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    utimesSync(join(tempDir, 'old.md'), oldDate, oldDate);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('date filtering', () => {
    it('--since filters to recently modified files', async () => {
      const allFiles = await vault.listFiles('**/*.md');
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const recent = allFiles.filter(f => {
        try {
          return vault.fileStat(f).mtime >= oneWeekAgo;
        } catch {
          return false;
        }
      });

      // recent.md, note1.md, note2.md should be recent; old.md should not
      expect(recent).toContain('recent.md');
      expect(recent).not.toContain('old.md');
    });

    it('--before filters to files before a date', async () => {
      const allFiles = await vault.listFiles('**/*.md');
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const oldFiles = allFiles.filter(f => {
        try {
          return vault.fileStat(f).mtime <= thirtyDaysAgo;
        } catch {
          return false;
        }
      });

      expect(oldFiles).toContain('old.md');
      expect(oldFiles).not.toContain('recent.md');
    });
  });

  describe('frontmatter filtering', () => {
    it('filters by single frontmatter key=value', async () => {
      const allFiles = await vault.listFiles('**/*.md');
      const drafts = allFiles.filter(f => {
        try {
          const parsed = vault.readFile(f);
          return String(parsed.frontmatter['status']) === 'draft';
        } catch {
          return false;
        }
      });

      expect(drafts).toContain('recent.md');
      expect(drafts).not.toContain('old.md');
    });

    it('filters by multiple frontmatter conditions (AND)', async () => {
      const allFiles = await vault.listFiles('**/*.md');
      const filters = [
        { key: 'status', value: 'draft' },
        { key: 'type', value: 'idea' },
      ];

      const matches = allFiles.filter(f => {
        try {
          const parsed = vault.readFile(f);
          return filters.every(({ key, value }) => {
            const fmVal = parsed.frontmatter[key];
            if (fmVal === undefined || fmVal === null) return false;
            if (Array.isArray(fmVal)) return fmVal.map(String).includes(value);
            return String(fmVal) === value;
          });
        } catch {
          return false;
        }
      });

      expect(matches).toContain('recent.md');
      expect(matches).not.toContain('old.md');
    });

    it('handles array frontmatter values', async () => {
      // note1.md has tags: [test, example]
      const parsed = vault.readFile('note1.md');
      const tags = parsed.frontmatter['tags'];
      expect(Array.isArray(tags)).toBe(true);
      expect((tags as string[]).map(String)).toContain('test');
    });
  });
});
