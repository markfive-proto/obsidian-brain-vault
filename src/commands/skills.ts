import { Command } from 'commander';
import { existsSync, mkdirSync, readdirSync, readFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { output, printError, printSuccess, printTable } from '../utils/output.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve the bundled skills directory (two levels up from dist/commands/)
function getSkillsRoot(): string {
  // In dev: src/commands/ -> ../../skills/
  // In dist: dist/commands/ -> ../../skills/
  const root = join(__dirname, '..', '..');
  const skillsDir = join(root, 'skills');
  if (!existsSync(skillsDir)) {
    throw new Error(`Skills directory not found at: ${skillsDir}`);
  }
  return skillsDir;
}

interface SkillPackInfo {
  name: string;
  description: string;
  commands: string[];
  version: string;
}

function readSkillPack(skillsRoot: string, packName: string): SkillPackInfo | null {
  const packDir = join(skillsRoot, packName);
  const skillFile = join(packDir, 'SKILL.md');

  if (!existsSync(skillFile)) return null;

  const content = readFileSync(skillFile, 'utf-8');

  // Parse YAML frontmatter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  let description = '';
  let version = '0.1.0';
  if (fmMatch) {
    const fm = fmMatch[1];
    const descMatch = fm.match(/description:\s*"([^"]+)"/);
    if (descMatch) description = descMatch[1];
    const verMatch = fm.match(/version:\s*"([^"]+)"/);
    if (verMatch) version = verMatch[1];
  }

  // Extract command names (lines starting with ### /)
  const commands = Array.from(content.matchAll(/^### (\/\w+)/gm)).map(m => m[1]);

  return { name: packName, description, commands, version };
}

function listAvailablePacks(skillsRoot: string): SkillPackInfo[] {
  const entries = readdirSync(skillsRoot, { withFileTypes: true });
  const packs: SkillPackInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const info = readSkillPack(skillsRoot, entry.name);
    if (info) packs.push(info);
  }

  return packs;
}

function getInstallTarget(local: boolean): string {
  if (local) {
    return join(process.cwd(), '.claude', 'commands');
  }
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return join(home, '.claude', 'commands');
}

export function registerSkillsCommands(program: Command): void {
  const skills = program
    .command('skills')
    .description('Manage cognitive skill packs for Claude Code')
    .addHelpText('after', `
Examples:
  $ obs skills list
  $ obs skills info capture
  $ obs skills install capture
  $ obs skills install capture --local`);

  skills
    .command('list')
    .description('List available skill packs')
    .action(() => {
      const opts = program.opts();
      const jsonMode = opts.json;

      try {
        const skillsRoot = getSkillsRoot();
        const packs = listAvailablePacks(skillsRoot);

        if (jsonMode) {
          output(packs, { json: true });
          return;
        }

        if (packs.length === 0) {
          console.log('No skill packs found.');
          return;
        }

        console.log('Available skill packs:\n');
        printTable(
          ['Pack', 'Commands', 'Description'],
          packs.map(p => [
            p.name,
            p.commands.join(', ') || '(see SKILL.md)',
            p.description.length > 60 ? p.description.slice(0, 57) + '...' : p.description,
          ]),
        );
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  skills
    .command('info <pack>')
    .description('Show details for a skill pack')
    .action((packName: string) => {
      const opts = program.opts();
      const jsonMode = opts.json;

      try {
        const skillsRoot = getSkillsRoot();
        const info = readSkillPack(skillsRoot, packName);

        if (!info) {
          printError(`Skill pack not found: "${packName}". Run "obs skills list" to see available packs.`);
          process.exit(1);
        }

        if (jsonMode) {
          output(info, { json: true });
          return;
        }

        console.log(`Skill Pack: ${info.name} (v${info.version})\n`);
        console.log(`${info.description}\n`);
        if (info.commands.length > 0) {
          console.log('Commands:');
          for (const cmd of info.commands) {
            console.log(`  ${cmd}`);
          }
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  skills
    .command('install <pack>')
    .description('Install a skill pack to Claude Code commands directory')
    .option('--local', 'Install to .claude/commands/ in current project instead of global')
    .action((packName: string, cmdOpts: { local?: boolean }) => {
      const opts = program.opts();
      const jsonMode = opts.json;

      try {
        const skillsRoot = getSkillsRoot();
        const packDir = join(skillsRoot, packName);
        const skillFile = join(packDir, 'SKILL.md');

        if (!existsSync(skillFile)) {
          printError(`Skill pack not found: "${packName}". Run "obs skills list" to see available packs.`);
          process.exit(1);
        }

        const targetDir = getInstallTarget(cmdOpts.local ?? false);
        const targetFile = join(targetDir, `${packName}.md`);

        // Ensure target directory exists
        if (!existsSync(targetDir)) {
          mkdirSync(targetDir, { recursive: true });
        }

        copyFileSync(skillFile, targetFile);

        if (jsonMode) {
          output({ pack: packName, installedTo: targetFile, scope: cmdOpts.local ? 'local' : 'global' }, { json: true });
          return;
        }

        const scope = cmdOpts.local ? 'project' : 'global';
        printSuccess(`Installed "${packName}" skill pack (${scope})`);
        console.log(`  → ${targetFile}`);

        // Show available commands
        const info = readSkillPack(skillsRoot, packName);
        if (info && info.commands.length > 0) {
          console.log(`\nAvailable commands: ${info.commands.join(', ')}`);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });
}
