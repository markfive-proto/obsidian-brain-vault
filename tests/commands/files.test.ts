import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../../src/vault.js';

const FIXTURE_PATH = join(__dirname, '..', 'fixtures', 'test-vault');

describe('File operations via Vault', () => {
  let tempDir: string;
  let vault: Vault;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'files-test-'));
    cpSync(FIXTURE_PATH, tempDir, { recursive: true });
    vault = new Vault(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('read', () => {
    it('reads a file and returns its full content', () => {
      const raw = vault.readFileRaw('note1.md');
      expect(raw).toContain('tags:');
      expect(raw).toContain('[[note2]]');
      expect(raw).toContain('#inline-tag');
    });

    it('reads parsed frontmatter and body separately', () => {
      const parsed = vault.readFile('note2.md');
      expect(parsed.frontmatter.title).toBe('Note Two');
      expect(parsed.body).toContain('- [ ] todo item');
      expect(parsed.body).toContain('- [x] done item');
    });
  });

  describe('create', () => {
    it('creates a new file and verifies it exists', () => {
      const content = '---\ntitle: "New Note"\n---\n\nBrand new content.\n';
      vault.writeFile('new-note.md', content);

      expect(vault.fileExists('new-note.md')).toBe(true);

      const readBack = vault.readFile('new-note.md');
      expect(readBack.frontmatter.title).toBe('New Note');
      expect(readBack.body).toContain('Brand new content.');
    });

    it('creates a file in a subdirectory', () => {
      const { mkdirSync } = require('node:fs');
      mkdirSync(join(tempDir, 'subfolder'), { recursive: true });

      vault.writeFile('subfolder/deep-note.md', '# Deep Note\n');
      expect(vault.fileExists('subfolder/deep-note.md')).toBe(true);

      const raw = vault.readFileRaw('subfolder/deep-note.md');
      expect(raw).toBe('# Deep Note\n');
    });
  });

  describe('delete', () => {
    it('deletes a file and verifies it is gone', () => {
      expect(vault.fileExists('note1.md')).toBe(true);

      vault.deleteFile('note1.md');

      expect(vault.fileExists('note1.md')).toBe(false);
    });

    it('throws when deleting a non-existent file', () => {
      expect(() => vault.deleteFile('ghost.md')).toThrow();
    });
  });

  describe('move', () => {
    it('moves a file to a new path', () => {
      expect(vault.fileExists('note1.md')).toBe(true);

      vault.moveFile('note1.md', 'moved-note1.md');

      expect(vault.fileExists('note1.md')).toBe(false);
      expect(vault.fileExists('moved-note1.md')).toBe(true);

      const content = vault.readFileRaw('moved-note1.md');
      expect(content).toContain('[[note2]]');
    });

    it('moves a file into a subdirectory', () => {
      vault.moveFile('note2.md', 'daily/note2.md');

      expect(vault.fileExists('note2.md')).toBe(false);
      expect(vault.fileExists('daily/note2.md')).toBe(true);
    });
  });
});
