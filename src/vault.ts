import { readFileSync, writeFileSync, unlinkSync, renameSync, existsSync, statSync, type Stats } from 'node:fs';
import { join, resolve, relative, extname } from 'node:path';
import fg from 'fast-glob';
import matter from 'gray-matter';

export interface ParsedFile {
  content: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export class Vault {
  constructor(public readonly path: string) {}

  isValid(): boolean {
    return existsSync(join(this.path, '.obsidian'));
  }

  async listFiles(pattern = '**/*.md'): Promise<string[]> {
    return fg(pattern, {
      cwd: this.path,
      ignore: ['.obsidian/**', '.trash/**', 'node_modules/**'],
      dot: false,
    });
  }

  resolvePath(filePath: string): string {
    const fullPath = resolve(this.path, filePath);
    const rel = relative(this.path, fullPath);
    if (rel.startsWith('..') || rel.startsWith('/')) {
      throw new Error(`Path escapes vault directory: ${filePath}`);
    }
    return fullPath;
  }

  readFile(filePath: string): ParsedFile {
    const fullPath = this.resolvePath(filePath);
    const raw = readFileSync(fullPath, 'utf-8');
    const { data, content } = matter(raw);
    return { content: raw, frontmatter: data, body: content };
  }

  readFileRaw(filePath: string): string {
    return readFileSync(this.resolvePath(filePath), 'utf-8');
  }

  writeFile(filePath: string, content: string): void {
    writeFileSync(this.resolvePath(filePath), content, 'utf-8');
  }

  deleteFile(filePath: string): void {
    unlinkSync(this.resolvePath(filePath));
  }

  moveFile(from: string, to: string): void {
    renameSync(this.resolvePath(from), this.resolvePath(to));
  }

  fileExists(filePath: string): boolean {
    return existsSync(this.resolvePath(filePath));
  }

  fileStat(filePath: string): Stats {
    return statSync(this.resolvePath(filePath));
  }

  readObsidianConfig<T = unknown>(filename: string): T | null {
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      throw new Error(`Invalid config filename: ${filename}`);
    }
    const configPath = join(this.path, '.obsidian', filename);
    if (!existsSync(configPath)) return null;
    try {
      return JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  writeObsidianConfig(filename: string, data: unknown): void {
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      throw new Error(`Invalid config filename: ${filename}`);
    }
    const configPath = join(this.path, '.obsidian', filename);
    writeFileSync(configPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  }

  async getStats(): Promise<{ fileCount: number; folderCount: number; totalSize: number; byExtension: Record<string, number> }> {
    const allFiles = await fg('**/*', {
      cwd: this.path,
      ignore: ['.obsidian/**', '.trash/**', 'node_modules/**'],
      dot: false,
      stats: true,
      objectMode: true,
    });

    const folders = new Set<string>();
    let totalSize = 0;
    const byExtension: Record<string, number> = {};

    for (const entry of allFiles) {
      const fullPath = this.resolvePath(entry.path);
      try {
        const stat = statSync(fullPath);
        totalSize += stat.size;
      } catch {
        // skip inaccessible files
      }

      const ext = extname(entry.path) || '(none)';
      byExtension[ext] = (byExtension[ext] || 0) + 1;

      const parts = entry.path.split('/');
      for (let i = 1; i < parts.length; i++) {
        folders.add(parts.slice(0, i).join('/'));
      }
    }

    return {
      fileCount: allFiles.length,
      folderCount: folders.size,
      totalSize,
      byExtension,
    };
  }
}
