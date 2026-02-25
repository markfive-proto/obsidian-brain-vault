import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../../src/vault.js';

const FIXTURE_PATH = join(__dirname, '..', 'fixtures', 'test-vault');

describe('Vault', () => {
  let tempDir: string;
  let vault: Vault;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'vault-test-'));
    cpSync(FIXTURE_PATH, tempDir, { recursive: true });
    vault = new Vault(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('isValid()', () => {
    it('returns true for a vault with .obsidian directory', () => {
      expect(vault.isValid()).toBe(true);
    });

    it('returns false for a directory without .obsidian', () => {
      const emptyDir = mkdtempSync(join(tmpdir(), 'not-a-vault-'));
      const invalidVault = new Vault(emptyDir);
      expect(invalidVault.isValid()).toBe(false);
      rmSync(emptyDir, { recursive: true, force: true });
    });
  });

  describe('listFiles()', () => {
    it('returns markdown files in the vault', async () => {
      const files = await vault.listFiles();
      expect(files).toContain('note1.md');
      expect(files).toContain('note2.md');
      expect(files).toContain('templates/basic.md');
    });

    it('excludes .obsidian directory files', async () => {
      const files = await vault.listFiles();
      const obsidianFiles = files.filter((f) => f.startsWith('.obsidian'));
      expect(obsidianFiles).toHaveLength(0);
    });
  });

  describe('readFile()', () => {
    it('parses frontmatter tags correctly', () => {
      const parsed = vault.readFile('note1.md');
      expect(parsed.frontmatter.tags).toEqual(['test', 'example']);
    });

    it('parses frontmatter title correctly', () => {
      const parsed = vault.readFile('note2.md');
      expect(parsed.frontmatter.title).toBe('Note Two');
    });

    it('returns body content without frontmatter delimiters', () => {
      const parsed = vault.readFile('note1.md');
      expect(parsed.body).toContain('[[note2]]');
      expect(parsed.body).not.toContain('tags:');
    });
  });

  describe('writeFile() and readFile() round-trip', () => {
    it('writes content and reads it back correctly', () => {
      const content = '---\ntitle: "Round Trip"\n---\n\nHello world\n';
      vault.writeFile('roundtrip.md', content);

      const parsed = vault.readFile('roundtrip.md');
      expect(parsed.frontmatter.title).toBe('Round Trip');
      expect(parsed.body).toContain('Hello world');
      expect(parsed.content).toBe(content);
    });
  });

  describe('fileExists()', () => {
    it('returns true for existing files', () => {
      expect(vault.fileExists('note1.md')).toBe(true);
    });

    it('returns false for non-existing files', () => {
      expect(vault.fileExists('does-not-exist.md')).toBe(false);
    });
  });

  describe('readObsidianConfig()', () => {
    it('returns parsed JSON for existing config files', () => {
      const config = vault.readObsidianConfig<{ folder: string; format: string }>('daily-notes.json');
      expect(config).toEqual({ folder: 'daily', format: 'YYYY-MM-DD' });
    });

    it('returns parsed JSON for templates config', () => {
      const config = vault.readObsidianConfig<{ folder: string }>('templates.json');
      expect(config).toEqual({ folder: 'templates' });
    });

    it('returns null for missing config files', () => {
      const config = vault.readObsidianConfig('nonexistent.json');
      expect(config).toBeNull();
    });
  });
});
