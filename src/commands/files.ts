import { Command } from 'commander';
import { dirname, join, basename } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Vault } from '../vault.js';
import { getVaultPath } from '../config.js';
import { output, printTable, printError, printSuccess, formatBytes } from '../utils/output.js';
import { parseFrontmatter, serializeFrontmatter } from '../utils/frontmatter.js';

export function registerFilesCommands(program: Command): void {
  const files = program
    .command('files')
    .description('File operations')
    .addHelpText('after', `
Examples:
  $ obs files list --folder Notes --sort modified --limit 20
  $ obs files read path/to/note.md --head 10
  $ obs files create path/to/new-note.md --template Meeting
  $ obs files move old/path.md new/path.md
  $ obs files delete path/to/note.md --force`);

  files
    .command('list')
    .description('List files in the vault')
    .option('--folder <path>', 'Filter by folder path')
    .option('--sort <field>', 'Sort by: name, modified, size', 'name')
    .option('--limit <n>', 'Limit number of results')
    .action(async (cmdOpts) => {
      const opts = program.opts();
      const jsonMode = opts.json;

      try {
        const vaultPath = getVaultPath(opts.vault);
        const v = new Vault(vaultPath);

        let fileList = await v.listFiles('**/*');

        // Filter by folder prefix
        if (cmdOpts.folder) {
          const folder = cmdOpts.folder.replace(/\/$/, '');
          fileList = fileList.filter(f => f.startsWith(folder + '/') || f === folder);
        }

        // Sort
        const sortField: string = cmdOpts.sort;
        if (sortField === 'modified') {
          fileList.sort((a, b) => {
            try {
              return v.fileStat(b).mtime.getTime() - v.fileStat(a).mtime.getTime();
            } catch {
              return 0;
            }
          });
        } else if (sortField === 'size') {
          fileList.sort((a, b) => {
            try {
              return v.fileStat(b).size - v.fileStat(a).size;
            } catch {
              return 0;
            }
          });
        } else {
          // default: sort by name
          fileList.sort((a, b) => a.localeCompare(b));
        }

        // Limit
        if (cmdOpts.limit) {
          const limit = parseInt(cmdOpts.limit, 10);
          if (!isNaN(limit) && limit > 0) {
            fileList = fileList.slice(0, limit);
          }
        }

        if (jsonMode) {
          output(fileList, { json: true });
        } else {
          if (fileList.length === 0) {
            console.log('No files found.');
          } else {
            for (const file of fileList) {
              console.log(file);
            }
            console.log(`\n${fileList.length} file(s)`);
          }
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  files
    .command('read <path>')
    .description('Read file content')
    .option('--head <n>', 'Show first N lines')
    .option('--tail <n>', 'Show last N lines')
    .action((filePath: string, cmdOpts) => {
      const opts = program.opts();

      try {
        const vaultPath = getVaultPath(opts.vault);
        const v = new Vault(vaultPath);

        if (!v.fileExists(filePath)) {
          printError(`File not found: ${filePath}`);
          process.exit(1);
        }

        let content = v.readFileRaw(filePath);
        const lines = content.split('\n');

        if (cmdOpts.head) {
          const n = parseInt(cmdOpts.head, 10);
          if (!isNaN(n) && n > 0) {
            content = lines.slice(0, n).join('\n');
          }
        } else if (cmdOpts.tail) {
          const n = parseInt(cmdOpts.tail, 10);
          if (!isNaN(n) && n > 0) {
            content = lines.slice(-n).join('\n');
          }
        }

        if (opts.json) {
          output({ path: filePath, content }, { json: true });
        } else {
          console.log(content);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  files
    .command('write <path>')
    .description('Write content to an existing file')
    .requiredOption('--content <string>', 'Content to write')
    .action((filePath: string, cmdOpts) => {
      const opts = program.opts();

      try {
        const vaultPath = getVaultPath(opts.vault);
        const v = new Vault(vaultPath);

        if (!v.fileExists(filePath)) {
          printError(`File not found: ${filePath}. Use 'files create' to create a new file.`);
          process.exit(1);
        }

        // Preserve existing frontmatter if present
        const existing = v.readFileRaw(filePath);
        const { data } = parseFrontmatter(existing);
        const hasFrontmatter = Object.keys(data).length > 0;

        let newContent: string;
        if (hasFrontmatter) {
          newContent = serializeFrontmatter(data, '\n' + cmdOpts.content + '\n');
        } else {
          newContent = cmdOpts.content;
        }

        v.writeFile(filePath, newContent);

        if (opts.json) {
          output({ path: filePath, status: 'written' }, { json: true });
        } else {
          printSuccess(`Written to ${filePath}`);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  files
    .command('create <path>')
    .description('Create a new file')
    .option('--template <name>', 'Template name to use')
    .option('--content <string>', 'Initial content')
    .action((filePath: string, cmdOpts) => {
      const opts = program.opts();

      try {
        const vaultPath = getVaultPath(opts.vault);
        const v = new Vault(vaultPath);

        if (v.fileExists(filePath)) {
          printError(`File already exists: ${filePath}`);
          process.exit(1);
        }

        let content = '';

        if (cmdOpts.template) {
          // Look for template in common template locations
          const templateLocations = [
            `Templates/${cmdOpts.template}.md`,
            `templates/${cmdOpts.template}.md`,
            `_templates/${cmdOpts.template}.md`,
            `${cmdOpts.template}.md`,
          ];

          let templateContent: string | null = null;
          for (const loc of templateLocations) {
            if (v.fileExists(loc)) {
              templateContent = v.readFileRaw(loc);
              break;
            }
          }

          if (templateContent === null) {
            printError(`Template not found: ${cmdOpts.template}`);
            process.exit(1);
          }

          content = templateContent;
        } else if (cmdOpts.content) {
          content = cmdOpts.content;
        }

        // Ensure parent directory exists
        const fullPath = v.resolvePath(filePath);
        const dir = dirname(fullPath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }

        v.writeFile(filePath, content);

        if (opts.json) {
          output({ path: filePath, status: 'created' }, { json: true });
        } else {
          printSuccess(`Created ${filePath}`);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  files
    .command('delete <path>')
    .description('Delete a file')
    .option('--force', 'Skip confirmation')
    .action(async (filePath: string, cmdOpts) => {
      const opts = program.opts();

      try {
        const vaultPath = getVaultPath(opts.vault);
        const v = new Vault(vaultPath);

        if (!v.fileExists(filePath)) {
          printError(`File not found: ${filePath}`);
          process.exit(1);
        }

        if (!cmdOpts.force) {
          const confirmed = await confirmPrompt(`Delete ${filePath}?`);
          if (!confirmed) {
            console.log('Aborted.');
            return;
          }
        }

        v.deleteFile(filePath);

        if (opts.json) {
          output({ path: filePath, status: 'deleted' }, { json: true });
        } else {
          printSuccess(`Deleted ${filePath}`);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  files
    .command('move <source> <dest>')
    .description('Move or rename a file')
    .action((source: string, dest: string) => {
      const opts = program.opts();

      try {
        const vaultPath = getVaultPath(opts.vault);
        const v = new Vault(vaultPath);

        if (!v.fileExists(source)) {
          printError(`Source file not found: ${source}`);
          process.exit(1);
        }

        if (v.fileExists(dest)) {
          printError(`Destination already exists: ${dest}`);
          process.exit(1);
        }

        // Ensure destination directory exists
        const fullDest = v.resolvePath(dest);
        const destDir = dirname(fullDest);
        if (!existsSync(destDir)) {
          mkdirSync(destDir, { recursive: true });
        }

        v.moveFile(source, dest);

        if (opts.json) {
          output({ source, dest, status: 'moved' }, { json: true });
        } else {
          printSuccess(`Moved ${source} -> ${dest}`);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  files
    .command('rename <path> <newname>')
    .description('Rename a file in the same directory')
    .action((filePath: string, newName: string) => {
      const opts = program.opts();

      try {
        const vaultPath = getVaultPath(opts.vault);
        const v = new Vault(vaultPath);

        if (!v.fileExists(filePath)) {
          printError(`File not found: ${filePath}`);
          process.exit(1);
        }

        const dir = dirname(filePath);
        const dest = dir === '.' ? newName : join(dir, newName);

        if (v.fileExists(dest)) {
          printError(`File already exists: ${dest}`);
          process.exit(1);
        }

        v.moveFile(filePath, dest);

        if (opts.json) {
          output({ source: filePath, dest, status: 'renamed' }, { json: true });
        } else {
          printSuccess(`Renamed ${filePath} -> ${dest}`);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  files
    .command('total')
    .description('Count of markdown files')
    .action(async () => {
      const opts = program.opts();

      try {
        const vaultPath = getVaultPath(opts.vault);
        const v = new Vault(vaultPath);

        const mdFiles = await v.listFiles('**/*.md');
        const count = mdFiles.length;

        if (opts.json) {
          output({ count }, { json: true });
        } else {
          console.log(`${count} markdown file(s)`);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });
}

async function confirmPrompt(message: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} (y/N) `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}
