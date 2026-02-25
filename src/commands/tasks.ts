import { Command } from 'commander';
import { Vault } from '../vault.js';
import { getVaultPath } from '../config.js';
import { output, printTable, printError, printSuccess } from '../utils/output.js';
import { extractTasks } from '../utils/markdown.js';

interface TaskEntry {
  file: string;
  line: number;
  status: string;
  text: string;
}

async function gatherTasks(
  v: Vault,
  filter: 'all' | 'pending' | 'done',
  filePath?: string,
  limit = 100,
): Promise<TaskEntry[]> {
  const files = filePath ? [filePath] : await v.listFiles();
  const results: TaskEntry[] = [];

  for (const file of files) {
    if (results.length >= limit) break;

    try {
      const raw = v.readFileRaw(file);
      const tasks = extractTasks(raw);

      for (const task of tasks) {
        if (filter === 'pending' && task.done) continue;
        if (filter === 'done' && !task.done) continue;

        results.push({
          file,
          line: task.line,
          status: task.done ? 'done' : 'pending',
          text: task.text,
        });

        if (results.length >= limit) break;
      }
    } catch {
      // skip unreadable files
    }
  }

  return results;
}

function displayTasks(tasks: TaskEntry[], jsonMode: boolean): void {
  if (jsonMode) {
    output(tasks, { json: true });
  } else if (tasks.length === 0) {
    console.log('No tasks found.');
  } else {
    const rows = tasks.map(t => [t.file, t.line, t.status, t.text]);
    printTable(['File', 'Line', 'Status', 'Text'], rows);
  }
}

export function registerTasksCommands(program: Command): void {
  const tasks = program
    .command('tasks')
    .description('Find and manage tasks across the vault');

  function registerTaskListCommand(
    name: string,
    description: string,
    filter: 'all' | 'pending' | 'done',
  ): void {
    tasks
      .command(name)
      .description(description)
      .option('--file <path>', 'Limit to a specific file')
      .option('--limit <n>', 'Maximum number of tasks to show', '100')
      .action(async (cmdOpts: { file?: string; limit: string }) => {
        const opts = program.opts();

        try {
          const vaultPath = getVaultPath(opts.vault);
          const v = new Vault(vaultPath);

          if (cmdOpts.file && !v.fileExists(cmdOpts.file)) {
            printError(`File not found: ${cmdOpts.file}`);
            process.exit(1);
          }

          const results = await gatherTasks(v, filter, cmdOpts.file, parseInt(cmdOpts.limit, 10));
          displayTasks(results, opts.json);
        } catch (err) {
          printError((err as Error).message);
          process.exit(1);
        }
      });
  }

  registerTaskListCommand('all', 'List all tasks (checked and unchecked)', 'all');
  registerTaskListCommand('pending', 'List pending (unchecked) tasks', 'pending');
  registerTaskListCommand('done', 'List completed (checked) tasks', 'done');

  tasks
    .command('add <file> <text>')
    .description('Add a new task to the end of a file')
    .action((file: string, text: string) => {
      const opts = program.opts();

      try {
        const vaultPath = getVaultPath(opts.vault);
        const v = new Vault(vaultPath);

        if (!v.fileExists(file)) {
          printError(`File not found: ${file}`);
          process.exit(1);
        }

        const raw = v.readFileRaw(file);
        const newLine = raw.endsWith('\n') ? `- [ ] ${text}\n` : `\n- [ ] ${text}\n`;
        v.writeFile(file, raw + newLine);

        printSuccess(`Added task to ${file}`);
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  tasks
    .command('toggle <file> <line-number>')
    .description('Toggle a task checkbox at the given line number')
    .action((file: string, lineNumber: string) => {
      const opts = program.opts();

      try {
        const vaultPath = getVaultPath(opts.vault);
        const v = new Vault(vaultPath);

        if (!v.fileExists(file)) {
          printError(`File not found: ${file}`);
          process.exit(1);
        }

        const raw = v.readFileRaw(file);
        const lines = raw.split('\n');
        const idx = parseInt(lineNumber, 10) - 1;

        if (idx < 0 || idx >= lines.length) {
          printError(`Line number ${lineNumber} is out of range (file has ${lines.length} lines).`);
          process.exit(1);
        }

        const line = lines[idx];

        if (/\[ \]/.test(line)) {
          lines[idx] = line.replace('[ ]', '[x]');
          printSuccess(`Checked task at line ${lineNumber} in ${file}`);
        } else if (/\[x\]/i.test(line)) {
          lines[idx] = line.replace(/\[x\]/i, '[ ]');
          printSuccess(`Unchecked task at line ${lineNumber} in ${file}`);
        } else {
          printError(`Line ${lineNumber} is not a task line.`);
          process.exit(1);
        }

        v.writeFile(file, lines.join('\n'));
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  tasks
    .command('remove <file> <line-number>')
    .description('Remove a task line entirely')
    .action((file: string, lineNumber: string) => {
      const opts = program.opts();

      try {
        const vaultPath = getVaultPath(opts.vault);
        const v = new Vault(vaultPath);

        if (!v.fileExists(file)) {
          printError(`File not found: ${file}`);
          process.exit(1);
        }

        const raw = v.readFileRaw(file);
        const lines = raw.split('\n');
        const idx = parseInt(lineNumber, 10) - 1;

        if (idx < 0 || idx >= lines.length) {
          printError(`Line number ${lineNumber} is out of range (file has ${lines.length} lines).`);
          process.exit(1);
        }

        const line = lines[idx];
        if (!/\[[ x]\]/i.test(line)) {
          printError(`Line ${lineNumber} is not a task line.`);
          process.exit(1);
        }

        lines.splice(idx, 1);
        v.writeFile(file, lines.join('\n'));

        printSuccess(`Removed task at line ${lineNumber} from ${file}`);
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });
}
