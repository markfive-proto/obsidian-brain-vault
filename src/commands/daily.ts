import { Command } from 'commander';
import { basename, dirname } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { format } from 'date-fns';
import { Vault } from '../vault.js';
import { getVaultPath } from '../config.js';
import { output, printTable, printError, printSuccess } from '../utils/output.js';
import { momentToDateFns, getTemplatesFolder, applyTemplateVariables } from '../utils/template.js';

interface DailyNotesConfig {
  folder?: string;
  format?: string;
  template?: string;
}

function getDailyNotesConfig(vault: Vault): DailyNotesConfig {
  const config = vault.readObsidianConfig<DailyNotesConfig>('daily-notes.json');
  return {
    folder: config?.folder ?? '',
    format: config?.format ?? 'YYYY-MM-DD',
    template: config?.template,
  };
}

function getDailyNotePath(vault: Vault, dateStr?: string): string {
  const config = getDailyNotesConfig(vault);
  const dateFnsFormat = momentToDateFns(config.format!);
  const date = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
  const fileName = format(date, dateFnsFormat);
  const folder = config.folder || '';
  return folder ? `${folder}/${fileName}.md` : `${fileName}.md`;
}

export function registerDailyCommands(program: Command): void {
  const daily = program
    .command('daily')
    .description('Daily notes management')
    .addHelpText('after', `
Examples:
  $ obs daily create
  $ obs daily create --date 2025-01-15 --template "Daily Template"
  $ obs daily open
  $ obs daily open --date 2025-01-15
  $ obs daily list --limit 30 --days 7`);

  daily
    .command('create')
    .description('Create a daily note')
    .option('--date <date>', 'Date in YYYY-MM-DD format (default: today)')
    .option('--template <name>', 'Template to use')
    .action(async (opts) => {
      const programOpts = program.opts();
      const jsonMode = programOpts.json;

      try {
        const vaultPath = getVaultPath(programOpts.vault);
        const vault = new Vault(vaultPath);

        if (!vault.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        const notePath = getDailyNotePath(vault, opts.date);

        if (vault.fileExists(notePath)) {
          if (jsonMode) {
            output({ path: notePath, status: 'exists' }, { json: true });
          } else {
            printError(`Daily note already exists: ${notePath}`);
          }
          return;
        }

        let content = '';

        // Determine template to use
        const templateName = opts.template ?? getDailyNotesConfig(vault).template;
        if (templateName) {
          const templatesFolder = getTemplatesFolder(vault);
          const templatePath = templateName.endsWith('.md')
            ? `${templatesFolder}/${templateName}`
            : `${templatesFolder}/${templateName}.md`;

          if (vault.fileExists(templatePath)) {
            content = vault.readFileRaw(templatePath);
            const title = basename(notePath, '.md');
            content = applyTemplateVariables(content, title);
          } else {
            printError(`Template not found: ${templatePath}`);
            process.exit(1);
          }
        }

        // Ensure directory exists
        const fullDir = vault.resolvePath(dirname(notePath));
        if (!existsSync(fullDir)) {
          mkdirSync(fullDir, { recursive: true });
        }

        vault.writeFile(notePath, content);

        if (jsonMode) {
          output({ path: notePath, status: 'created' }, { json: true });
        } else {
          printSuccess(`Created daily note: ${notePath}`);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  daily
    .command('open')
    .description('Print content of a daily note')
    .option('--date <date>', 'Date in YYYY-MM-DD format (default: today)')
    .action(async (opts) => {
      const programOpts = program.opts();
      const jsonMode = programOpts.json;

      try {
        const vaultPath = getVaultPath(programOpts.vault);
        const vault = new Vault(vaultPath);

        if (!vault.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        const notePath = getDailyNotePath(vault, opts.date);

        if (!vault.fileExists(notePath)) {
          printError(`Daily note not found: ${notePath}`);
          process.exit(1);
        }

        const content = vault.readFileRaw(notePath);

        if (jsonMode) {
          output({ path: notePath, content }, { json: true });
        } else {
          output(content);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  daily
    .command('list')
    .description('List recent daily notes')
    .option('--limit <n>', 'Maximum number of notes to list', '10')
    .option('--days <n>', 'Number of days to look back')
    .action(async (opts) => {
      const programOpts = program.opts();
      const jsonMode = programOpts.json;

      try {
        const vaultPath = getVaultPath(programOpts.vault);
        const vault = new Vault(vaultPath);

        if (!vault.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        const config = getDailyNotesConfig(vault);
        const folder = config.folder || '';
        const pattern = folder ? `${folder}/**/*.md` : '**/*.md';

        const files = await vault.listFiles(pattern);

        // Sort by modification time descending
        const filesWithStats = files.map(file => {
          try {
            const stat = vault.fileStat(file);
            return { path: file, mtime: stat.mtime };
          } catch {
            return { path: file, mtime: new Date(0) };
          }
        });

        filesWithStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

        let filtered = filesWithStats;

        if (opts.days) {
          const daysAgo = new Date();
          daysAgo.setDate(daysAgo.getDate() - parseInt(opts.days, 10));
          filtered = filtered.filter(f => f.mtime >= daysAgo);
        }

        const limit = parseInt(opts.limit, 10);
        const result = filtered.slice(0, limit);

        if (jsonMode) {
          output(
            result.map(f => ({
              path: f.path,
              modified: f.mtime.toISOString(),
            })),
            { json: true },
          );
        } else {
          if (result.length === 0) {
            console.log('No daily notes found.');
            return;
          }
          printTable(
            ['File', 'Modified'],
            result.map(f => [f.path, f.mtime.toLocaleString()]),
          );
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });
}
