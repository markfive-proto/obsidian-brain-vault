import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';

export interface DetectedVault {
  name: string;
  path: string;
  source: string; // 'obsidian-config' | 'filesystem-scan'
}

function getObsidianConfigPath(): string {
  const home = homedir();
  switch (process.platform) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json');
    case 'win32':
      return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'obsidian', 'obsidian.json');
    default: // linux and others
      return join(home, '.config', 'obsidian', 'obsidian.json');
  }
}

function readObsidianRegistry(): DetectedVault[] {
  const configPath = getObsidianConfigPath();
  if (!existsSync(configPath)) return [];

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const data = JSON.parse(raw);
    const vaults: DetectedVault[] = [];

    if (data.vaults && typeof data.vaults === 'object') {
      for (const id of Object.keys(data.vaults)) {
        const entry = data.vaults[id];
        if (entry && typeof entry.path === 'string') {
          const resolvedPath = resolve(entry.path);
          if (existsSync(resolvedPath)) {
            vaults.push({
              name: basename(resolvedPath),
              path: resolvedPath,
              source: 'obsidian-config',
            });
          }
        }
      }
    }

    return vaults;
  } catch {
    return [];
  }
}

function scanCommonLocations(): DetectedVault[] {
  const home = homedir();
  const dirsToScan = [
    join(home, 'Documents'),
    home,
  ];

  const vaults: DetectedVault[] = [];

  for (const dir of dirsToScan) {
    if (!existsSync(dir)) continue;

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue;

        const candidate = join(dir, entry.name);
        const obsidianDir = join(candidate, '.obsidian');
        if (existsSync(obsidianDir)) {
          vaults.push({
            name: entry.name,
            path: resolve(candidate),
            source: 'filesystem-scan',
          });
        }
      }
    } catch {
      // skip inaccessible directories
    }
  }

  return vaults;
}

export function detectVaults(): DetectedVault[] {
  const all = [...readObsidianRegistry(), ...scanCommonLocations()];

  // Deduplicate by resolved path, keeping the first occurrence (config entries first)
  const seen = new Set<string>();
  const deduped: DetectedVault[] = [];
  for (const vault of all) {
    if (!seen.has(vault.path)) {
      seen.add(vault.path);
      deduped.push(vault);
    }
  }

  return deduped;
}
