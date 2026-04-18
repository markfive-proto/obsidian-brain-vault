import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir, platform as osPlatform } from 'node:os';
import { execFileSync } from 'node:child_process';

export type Editor =
  | 'claude-desktop'
  | 'claude-code'
  | 'cursor'
  | 'windsurf'
  | 'codex'
  | 'opencode';

export interface EditorDetection {
  editor: Editor;
  installed: boolean;
  configPath: string;
  alreadyConfigured: boolean;
}

export interface PatchResult {
  editor: Editor;
  configPath: string;
  backupPath?: string;
  changed: boolean;
  reason?: string;
}

export interface PatchOptions {
  serverName?: string;
  vaultPath?: string | null;
  command?: string;
  dryRun?: boolean;
  force?: boolean;
}

export const ALL_EDITORS: Editor[] = [
  'claude-desktop',
  'claude-code',
  'cursor',
  'windsurf',
  'codex',
  'opencode',
];

// ---------- Pure helpers ----------

export function configPathFor(
  editor: Editor,
  homeDir: string = homedir(),
  platform: NodeJS.Platform = osPlatform()
): string {
  switch (editor) {
    case 'claude-desktop': {
      if (platform === 'darwin') {
        return join(
          homeDir,
          'Library',
          'Application Support',
          'Claude',
          'claude_desktop_config.json'
        );
      }
      if (platform === 'win32') {
        const appData =
          process.env.APPDATA ?? join(homeDir, 'AppData', 'Roaming');
        return join(appData, 'Claude', 'claude_desktop_config.json');
      }
      return join(homeDir, '.config', 'Claude', 'claude_desktop_config.json');
    }
    case 'claude-code': {
      const a = join(homeDir, '.claude.json');
      const b = join(homeDir, '.claude', 'mcp.json');
      if (existsSync(a)) return a;
      if (existsSync(b)) return b;
      return a;
    }
    case 'cursor':
      return join(homeDir, '.cursor', 'mcp.json');
    case 'windsurf':
      return join(homeDir, '.codeium', 'windsurf', 'mcp_config.json');
    case 'codex':
      return join(homeDir, '.codex', 'config.toml');
    case 'opencode':
      return join(homeDir, '.config', 'opencode', 'config.json');
  }
}

function buildArgs(vaultPath: string | null | undefined): string[] {
  if (vaultPath == null || vaultPath === '') return [];
  return ['--vault', vaultPath];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value)
  );
}

function arraysEqual(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

export function buildJsonPatch(
  existing: unknown,
  serverName: string,
  command: string,
  args: string[]
): unknown {
  const root: Record<string, unknown> = isPlainObject(existing)
    ? { ...existing }
    : {};
  const serversRaw = root.mcpServers;
  const servers: Record<string, unknown> = isPlainObject(serversRaw)
    ? { ...serversRaw }
    : {};
  servers[serverName] = { command, args };
  root.mcpServers = servers;
  return root;
}

export function buildOpenCodePatch(
  existing: unknown,
  serverName: string,
  command: string,
  args: string[]
): unknown {
  const root: Record<string, unknown> = isPlainObject(existing)
    ? { ...existing }
    : {};
  const mcpRaw = root.mcp;
  const mcp: Record<string, unknown> = isPlainObject(mcpRaw)
    ? { ...mcpRaw }
    : {};
  mcp[serverName] = {
    type: 'local',
    command: [command, ...args],
  };
  root.mcp = mcp;
  return root;
}

export function jsonEntryMatches(
  existing: unknown,
  serverName: string,
  command: string,
  args: string[]
): 'missing' | 'identical' | 'different' {
  if (!isPlainObject(existing)) return 'missing';
  const servers = existing.mcpServers;
  if (!isPlainObject(servers)) return 'missing';
  const entry = servers[serverName];
  if (!isPlainObject(entry)) return 'missing';
  if (entry.command === command && arraysEqual(entry.args, args)) {
    return 'identical';
  }
  return 'different';
}

export function openCodeEntryMatches(
  existing: unknown,
  serverName: string,
  command: string,
  args: string[]
): 'missing' | 'identical' | 'different' {
  if (!isPlainObject(existing)) return 'missing';
  const mcp = existing.mcp;
  if (!isPlainObject(mcp)) return 'missing';
  const entry = mcp[serverName];
  if (!isPlainObject(entry)) return 'missing';
  const cmd = entry.command;
  if (
    entry.type === 'local' &&
    Array.isArray(cmd) &&
    cmd.length === 1 + args.length &&
    cmd[0] === command &&
    args.every((a, i) => cmd[i + 1] === a)
  ) {
    return 'identical';
  }
  return 'different';
}

// ---------- Minimal TOML (Codex only) ----------

interface TomlSection {
  header: string;
  start: number;
  end: number;
}

function findTomlSections(lines: string[]): TomlSection[] {
  const sections: TomlSection[] = [];
  let current: TomlSection | null = null;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const m = /^\[([^\]]+)\]\s*$/.exec(trimmed);
    if (m) {
      if (current) {
        current.end = i;
        sections.push(current);
      }
      current = { header: m[1], start: i, end: lines.length };
    }
  }
  if (current) sections.push(current);
  return sections;
}

function serializeTomlString(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function serializeTomlArray(arr: string[]): string {
  return '[' + arr.map(serializeTomlString).join(', ') + ']';
}

function renderObsTomlSection(
  serverName: string,
  command: string,
  args: string[]
): string {
  return (
    `[mcp_servers.${serverName}]\n` +
    `command = ${serializeTomlString(command)}\n` +
    `args = ${serializeTomlArray(args)}\n`
  );
}

export function buildTomlPatch(
  existingToml: string,
  serverName: string,
  command: string,
  args: string[]
): string {
  const newSection = renderObsTomlSection(serverName, command, args);
  if (existingToml.trim() === '') return newSection;

  const lines = existingToml.split('\n');
  const sections = findTomlSections(lines);
  const targetHeader = `mcp_servers.${serverName}`;
  const existingTarget = sections.find(s => s.header === targetHeader);

  if (existingTarget) {
    const before = lines.slice(0, existingTarget.start).join('\n');
    const after = lines.slice(existingTarget.end).join('\n');
    const beforePart = before.length > 0 ? before + '\n' : '';
    const afterPart = after.length > 0 ? '\n' + after : '';
    return beforePart + newSection.replace(/\n$/, '') + (afterPart || '\n');
  }

  const mcpSections = sections.filter(s =>
    s.header.startsWith('mcp_servers.')
  );
  const base = existingToml.endsWith('\n') ? existingToml : existingToml + '\n';

  if (mcpSections.length === 0) {
    return base + '\n' + newSection;
  }

  const last = mcpSections[mcpSections.length - 1];
  const before = lines.slice(0, last.end).join('\n');
  const after = lines.slice(last.end).join('\n');
  const needsSepBefore = before.endsWith('\n') ? '' : '\n';
  const beforePart = before + needsSepBefore;
  const afterPart = after.length > 0 ? '\n' + after : '';
  return beforePart + '\n' + newSection + afterPart;
}

export function tomlEntryMatches(
  existingToml: string,
  serverName: string,
  command: string,
  args: string[]
): 'missing' | 'identical' | 'different' {
  const lines = existingToml.split('\n');
  const sections = findTomlSections(lines);
  const target = sections.find(s => s.header === `mcp_servers.${serverName}`);
  if (!target) return 'missing';
  const body = lines.slice(target.start + 1, target.end).join('\n');
  const cmdMatch = /command\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(body);
  const argsMatch = /args\s*=\s*\[([^\]]*)\]/.exec(body);
  if (!cmdMatch || !argsMatch) return 'different';
  const cmd = cmdMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  const parsedArgs = argsMatch[1]
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(s => {
      const m = /^"((?:[^"\\]|\\.)*)"$/.exec(s);
      return m ? m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : s;
    });
  if (cmd === command && arraysEqual(parsedArgs, args)) return 'identical';
  return 'different';
}

// ---------- Side effects (isolated) ----------

function hasClaudeCli(): boolean {
  try {
    // execFile with shell: false by default; 'command -v' isn't a binary so
    // use 'which' which IS a binary on POSIX. On Windows, this will throw and
    // we'll fall through to file-edit path.
    execFileSync('which', ['claude'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function claudeMcpAdd(
  serverName: string,
  command: string,
  args: string[]
): void {
  // `claude mcp add <name> -- <command> [args...]`
  execFileSync('claude', ['mcp', 'add', serverName, '--', command, ...args], {
    stdio: 'ignore',
  });
}

function claudeMcpRemove(serverName: string): void {
  execFileSync('claude', ['mcp', 'remove', serverName], { stdio: 'ignore' });
}

function isEditorInstalled(
  editor: Editor,
  homeDir: string,
  platform: NodeJS.Platform
): boolean {
  switch (editor) {
    case 'claude-desktop':
      return existsSync(configPathFor(editor, homeDir, platform));
    case 'claude-code':
      return (
        hasClaudeCli() ||
        existsSync(join(homeDir, '.claude.json')) ||
        existsSync(join(homeDir, '.claude', 'mcp.json'))
      );
    case 'cursor':
      return existsSync(join(homeDir, '.cursor'));
    case 'windsurf':
      return existsSync(join(homeDir, '.codeium', 'windsurf'));
    case 'codex':
      return existsSync(configPathFor(editor, homeDir, platform));
    case 'opencode':
      return existsSync(join(homeDir, '.config', 'opencode'));
  }
}

function readFileSafe(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

function isConfiguredForEditor(
  editor: Editor,
  configPath: string,
  serverName: string
): boolean {
  const contents = readFileSafe(configPath);
  if (contents == null) return false;
  try {
    if (editor === 'codex') {
      const sections = findTomlSections(contents.split('\n'));
      return sections.some(s => s.header === `mcp_servers.${serverName}`);
    }
    if (editor === 'opencode') {
      const parsed = JSON.parse(contents) as unknown;
      if (!isPlainObject(parsed)) return false;
      const mcp = parsed.mcp;
      return isPlainObject(mcp) && serverName in mcp;
    }
    const parsed = JSON.parse(contents) as unknown;
    if (!isPlainObject(parsed)) return false;
    const servers = parsed.mcpServers;
    return isPlainObject(servers) && serverName in servers;
  } catch {
    return false;
  }
}

export function detectEditors(
  serverName: string = 'obs',
  homeDir: string = homedir(),
  platform: NodeJS.Platform = osPlatform()
): EditorDetection[] {
  return ALL_EDITORS.map(editor => {
    const configPath = configPathFor(editor, homeDir, platform);
    const installed = isEditorInstalled(editor, homeDir, platform);
    const alreadyConfigured = installed
      ? isConfiguredForEditor(editor, configPath, serverName)
      : false;
    return { editor, installed, configPath, alreadyConfigured };
  });
}

function writeBackup(path: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${path}.backup-${ts}`;
  copyFileSync(path, backupPath);
  return backupPath;
}

function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function patchJsonFile(
  editor: Editor,
  configPath: string,
  serverName: string,
  command: string,
  args: string[],
  opts: PatchOptions
): PatchResult {
  const existsBefore = existsSync(configPath);
  const raw = existsBefore ? readFileSafe(configPath) : null;
  let existing: unknown = {};
  if (raw != null && raw.trim() !== '') {
    try {
      existing = JSON.parse(raw);
    } catch {
      return {
        editor,
        configPath,
        changed: false,
        reason:
          'existing config file is not valid JSON; refusing to overwrite',
      };
    }
  }

  const isOpenCode = editor === 'opencode';
  const status = isOpenCode
    ? openCodeEntryMatches(existing, serverName, command, args)
    : jsonEntryMatches(existing, serverName, command, args);

  if (status === 'identical') {
    return { editor, configPath, changed: false, reason: 'already up to date' };
  }
  if (status === 'different' && !opts.force) {
    return {
      editor,
      configPath,
      changed: false,
      reason: `already has different ${serverName} entry — use --force to overwrite`,
    };
  }

  const next = isOpenCode
    ? buildOpenCodePatch(existing, serverName, command, args)
    : buildJsonPatch(existing, serverName, command, args);
  const serialized = JSON.stringify(next, null, 2) + '\n';

  if (opts.dryRun) {
    return {
      editor,
      configPath,
      changed: true,
      reason: 'dry-run: would write new entry',
    };
  }

  ensureDir(configPath);
  let backupPath: string | undefined;
  if (existsBefore) backupPath = writeBackup(configPath);
  writeFileSync(configPath, serialized, 'utf-8');
  return {
    editor,
    configPath,
    backupPath,
    changed: true,
    reason: existsBefore ? 'updated config' : 'created new config',
  };
}

function patchTomlFile(
  editor: Editor,
  configPath: string,
  serverName: string,
  command: string,
  args: string[],
  opts: PatchOptions
): PatchResult {
  const existsBefore = existsSync(configPath);
  const raw = existsBefore ? readFileSafe(configPath) ?? '' : '';
  const status = tomlEntryMatches(raw, serverName, command, args);

  if (status === 'identical') {
    return { editor, configPath, changed: false, reason: 'already up to date' };
  }
  if (status === 'different' && !opts.force) {
    return {
      editor,
      configPath,
      changed: false,
      reason: `already has different ${serverName} entry — use --force to overwrite`,
    };
  }

  const next = buildTomlPatch(raw, serverName, command, args);

  if (opts.dryRun) {
    return {
      editor,
      configPath,
      changed: true,
      reason: 'dry-run: would write new entry',
    };
  }

  ensureDir(configPath);
  let backupPath: string | undefined;
  if (existsBefore) backupPath = writeBackup(configPath);
  writeFileSync(configPath, next, 'utf-8');
  return {
    editor,
    configPath,
    backupPath,
    changed: true,
    reason: existsBefore ? 'updated config' : 'created new config',
  };
}

function patchClaudeCode(
  configPath: string,
  serverName: string,
  command: string,
  args: string[],
  opts: PatchOptions
): PatchResult {
  if (hasClaudeCli()) {
    const cliPath = 'via `claude mcp add` command';
    if (opts.dryRun) {
      return {
        editor: 'claude-code',
        configPath: cliPath,
        changed: true,
        reason: `dry-run: would run \`claude mcp add ${serverName} -- ${command}${
          args.length ? ' ' + args.join(' ') : ''
        }\``,
      };
    }
    if (opts.force) {
      try {
        claudeMcpRemove(serverName);
      } catch {
        /* ignore */
      }
    }
    try {
      claudeMcpAdd(serverName, command, args);
      return {
        editor: 'claude-code',
        configPath: cliPath,
        changed: true,
        reason: 'added via `claude mcp add` subprocess',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/already/i.test(msg)) {
        return {
          editor: 'claude-code',
          configPath: cliPath,
          changed: false,
          reason:
            'already has obs entry — use --force to overwrite via subprocess',
        };
      }
      return {
        editor: 'claude-code',
        configPath: cliPath,
        changed: false,
        reason: `subprocess failed: ${msg}`,
      };
    }
  }
  return patchJsonFile(
    'claude-code',
    configPath,
    serverName,
    command,
    args,
    opts
  );
}

export function patchEditor(editor: Editor, opts: PatchOptions): PatchResult {
  const serverName = opts.serverName ?? 'obs';
  const cmd = opts.command ?? 'obs-mcp';
  const args = buildArgs(opts.vaultPath);
  const homeDir = homedir();
  const platform = osPlatform();
  const configPath = configPathFor(editor, homeDir, platform);

  if (!isEditorInstalled(editor, homeDir, platform)) {
    return { editor, configPath, changed: false, reason: 'not installed' };
  }

  switch (editor) {
    case 'claude-desktop':
    case 'cursor':
    case 'windsurf':
    case 'opencode':
      return patchJsonFile(editor, configPath, serverName, cmd, args, opts);
    case 'codex':
      return patchTomlFile(editor, configPath, serverName, cmd, args, opts);
    case 'claude-code':
      return patchClaudeCode(configPath, serverName, cmd, args, opts);
  }
}

export function patchAllDetected(opts: PatchOptions): PatchResult[] {
  return ALL_EDITORS.map(editor => patchEditor(editor, opts));
}
