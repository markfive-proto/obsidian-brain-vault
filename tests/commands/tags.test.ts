import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../../src/vault.js';
import matter from 'gray-matter';
import { extractInlineTags } from '../../src/utils/markdown.js';

const FIXTURE_PATH = join(__dirname, '..', 'fixtures', 'test-vault');

/**
 * Parse the `tags` field from frontmatter, handling both array and
 * comma-separated string formats. Mirrors the logic in src/commands/tags.ts.
 */
function parseFrontmatterTags(frontmatter: Record<string, unknown>): string[] {
  const raw = frontmatter.tags;
  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw.map(String).map((t) => t.trim()).filter(Boolean);
  }

  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }

  return [];
}

describe('Tag operations', () => {
  let tempDir: string;
  let vault: Vault;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tags-test-'));
    cpSync(FIXTURE_PATH, tempDir, { recursive: true });
    vault = new Vault(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('reading tags from a file', () => {
    it('reads frontmatter tags from note1.md', () => {
      const parsed = vault.readFile('note1.md');
      const tags = parseFrontmatterTags(parsed.frontmatter);
      expect(tags).toEqual(['test', 'example']);
    });

    it('returns empty array for files without tags', () => {
      const parsed = vault.readFile('note2.md');
      const tags = parseFrontmatterTags(parsed.frontmatter);
      expect(tags).toEqual([]);
    });

    it('handles comma-separated string tags', () => {
      vault.writeFile('comma-tags.md', '---\ntags: alpha, beta, gamma\n---\n\nContent.\n');
      const parsed = vault.readFile('comma-tags.md');
      const tags = parseFrontmatterTags(parsed.frontmatter);
      expect(tags).toEqual(['alpha', 'beta', 'gamma']);
    });
  });

  describe('scanning vault for all tags', () => {
    it('finds both frontmatter and inline tags across all files', async () => {
      const files = await vault.listFiles();
      const tagCounts = new Map<string, number>();

      for (const file of files) {
        const raw = vault.readFileRaw(file);
        const { data, content } = matter(raw);

        // Frontmatter tags
        const fmTags = parseFrontmatterTags(data);
        for (const t of fmTags) {
          tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
        }

        // Inline tags
        const inlineTags = extractInlineTags(content);
        for (const t of inlineTags) {
          tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
        }
      }

      // Frontmatter tags from note1.md
      expect(tagCounts.has('test')).toBe(true);
      expect(tagCounts.has('example')).toBe(true);

      // Inline tag from note1.md
      expect(tagCounts.has('inline-tag')).toBe(true);
    });

    it('counts tag occurrences correctly', async () => {
      // Add a second file with the same frontmatter tag
      vault.writeFile('note3.md', '---\ntags:\n  - test\n---\n\nAnother note with #inline-tag here.\n');

      const files = await vault.listFiles();
      const tagCounts = new Map<string, number>();

      for (const file of files) {
        const raw = vault.readFileRaw(file);
        const { data, content } = matter(raw);

        const fmTags = parseFrontmatterTags(data);
        for (const t of fmTags) {
          tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
        }

        const inlineTags = extractInlineTags(content);
        for (const t of inlineTags) {
          tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
        }
      }

      // 'test' appears in note1.md and note3.md frontmatter
      expect(tagCounts.get('test')).toBe(2);

      // 'inline-tag' appears in note1.md and note3.md body
      expect(tagCounts.get('inline-tag')).toBe(2);

      // 'example' appears only in note1.md
      expect(tagCounts.get('example')).toBe(1);
    });
  });
});
