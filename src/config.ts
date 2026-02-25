import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface VaultEntry {
  path: string;
  name: string;
}

export interface CLIConfig {
  defaultVault?: string;
  vaults: Record<string, VaultEntry>;
  editor?: string;
  dailyNotesFolder?: string;
  templatesFolder?: string;
  dateFormat?: string;
}

const CONFIG_DIR = join(homedir(), '.obsidian-cli');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function readConfig(): CLIConfig {
  ensureConfigDir();
  if (!existsSync(CONFIG_FILE)) {
    return { vaults: {} };
  }
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return { vaults: {} };
  }
}

export function writeConfig(config: CLIConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

export function getConfigValue(key: string): unknown {
  const config = readConfig();
  return (config as unknown as Record<string, unknown>)[key];
}

export function setConfigValue(key: string, value: unknown): void {
  const config = readConfig();
  (config as unknown as Record<string, unknown>)[key] = value;
  writeConfig(config);
}

export function getVaultPath(cliOverride?: string): string {
  if (cliOverride) return cliOverride;
  const config = readConfig();
  if (config.defaultVault) return config.defaultVault;
  throw new Error(
    `No vault specified.

To get started, run:  obs init

Or specify a vault:
  obs --vault /path/to/vault <command>
  obs vault config defaultVault /path/to/vault`
  );
}
