import { Command } from 'commander';
import { basename, dirname } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { Vault } from '../vault.js';
import { getVaultPath } from '../config.js';
import { output, printTable, printError, printSuccess } from '../utils/output.js';
import { getTemplatesFolder, applyTemplateVariables } from '../utils/template.js';

export function registerTemplatesCommands(program: Command): void {
  const templates = program
    .command('templates')
    .description('Template management');

  templates
    .command('list')
    .description('List available templates')
    .action(async () => {
      const programOpts = program.opts();
      const jsonMode = programOpts.json;

      try {
        const vaultPath = getVaultPath(programOpts.vault);
        const vault = new Vault(vaultPath);

        if (!vault.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        const templatesFolder = getTemplatesFolder(vault);
        const pattern = `${templatesFolder}/**/*.md`;
        const files = await vault.listFiles(pattern);

        if (jsonMode) {
          output(files.map(f => ({ path: f, name: basename(f, '.md') })), { json: true });
        } else {
          if (files.length === 0) {
            console.log(`No templates found in "${templatesFolder}".`);
            return;
          }
          printTable(
            ['Template', 'Path'],
            files.map(f => [basename(f, '.md'), f]),
          );
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  templates
    .command('apply <template> <target>')
    .description('Apply a template to a target file')
    .action(async (templateName: string, target: string) => {
      const programOpts = program.opts();
      const jsonMode = programOpts.json;

      try {
        const vaultPath = getVaultPath(programOpts.vault);
        const vault = new Vault(vaultPath);

        if (!vault.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        const templatesFolder = getTemplatesFolder(vault);
        const templatePath = templateName.endsWith('.md')
          ? `${templatesFolder}/${templateName}`
          : `${templatesFolder}/${templateName}.md`;

        if (!vault.fileExists(templatePath)) {
          printError(`Template not found: ${templatePath}`);
          process.exit(1);
        }

        const templateContent = vault.readFileRaw(templatePath);

        // Title is the basename of the target without .md
        const targetFile = target.endsWith('.md') ? target : `${target}.md`;
        const title = basename(targetFile, '.md');

        const content = applyTemplateVariables(templateContent, title);

        // Ensure target directory exists
        const fullDir = vault.resolvePath(dirname(targetFile));
        if (!existsSync(fullDir)) {
          mkdirSync(fullDir, { recursive: true });
        }

        vault.writeFile(targetFile, content);

        if (jsonMode) {
          output({ template: templatePath, target: targetFile, status: 'applied' }, { json: true });
        } else {
          printSuccess(`Applied template "${templateName}" to ${targetFile}`);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  templates
    .command('create <name>')
    .description('Create a new template')
    .option('--content <string>', 'Template content', '')
    .action(async (name: string, opts) => {
      const programOpts = program.opts();
      const jsonMode = programOpts.json;

      try {
        const vaultPath = getVaultPath(programOpts.vault);
        const vault = new Vault(vaultPath);

        if (!vault.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        const templatesFolder = getTemplatesFolder(vault);
        const templatePath = name.endsWith('.md')
          ? `${templatesFolder}/${name}`
          : `${templatesFolder}/${name}.md`;

        if (vault.fileExists(templatePath)) {
          printError(`Template already exists: ${templatePath}`);
          process.exit(1);
        }

        // Ensure templates directory exists
        const fullDir = vault.resolvePath(dirname(templatePath));
        if (!existsSync(fullDir)) {
          mkdirSync(fullDir, { recursive: true });
        }

        vault.writeFile(templatePath, opts.content);

        if (jsonMode) {
          output({ path: templatePath, status: 'created' }, { json: true });
        } else {
          printSuccess(`Created template: ${templatePath}`);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });
}
