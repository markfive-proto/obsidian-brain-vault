import { join } from 'node:path';

/**
 * Directory layout shared between the obs kb CLI commands, the MCP tools,
 * and the Claude Code skill pack. Single source of truth.
 */
export const KB_DIRS = {
  raw: ['articles', 'papers', 'repos', 'transcripts', 'images', 'datasets'],
  compiled: ['concepts', 'people', 'orgs'],
  outputs: ['answers', 'reports', 'briefs', 'slides', 'charts', 'graphs', 'handbooks', 'lint', 'eval', 'autohunt', 'verify'],
} as const;

export function rawDir(vaultPath: string, sub: string): string {
  return join(vaultPath, 'raw', sub);
}

export function compiledDir(vaultPath: string, sub?: string): string {
  return sub ? join(vaultPath, 'compiled', sub) : join(vaultPath, 'compiled');
}

export function outputsDir(vaultPath: string, sub?: string): string {
  return sub ? join(vaultPath, 'outputs', sub) : join(vaultPath, 'outputs');
}

export function ingestLogPath(vaultPath: string): string {
  return join(vaultPath, 'raw', 'INGEST-LOG.md');
}
