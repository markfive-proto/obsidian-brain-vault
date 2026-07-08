import { Command } from 'commander';
import { Vault } from '../vault.js';
import { getVaultPath } from '../config.js';
import { output, printTable, printError, printSuccess } from '../utils/output.js';
import { extractTasks } from '../utils/markdown.js';
import { listTasks, createTask, claimTask, completeTask, type TaskStatus, type TaskQueue, type TaskPriority } from '../kb/tasks.js';

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

  registerQueueCommands(program, tasks);

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

// ── Structured task queue (tasks/{agent,human,done,failed}) ─────────────────

function registerQueueCommands(program: Command, tasks: Command): void {
  const queue = tasks
    .command('queue')
    .description('Structured task queue: one markdown file per task under tasks/{agent,human}');

  const openVault = (): Vault => {
    const v = new Vault(getVaultPath(program.opts().vault));
    if (!v.isValid()) {
      printError(`Not a valid Obsidian vault: ${v.path}`);
      process.exit(1);
    }
    return v;
  };

  queue
    .command('list')
    .description('List queued tasks')
    .option('--status <s>', 'pending | in-progress | done | failed | cancelled')
    .option('--queue <q>', 'agent | human')
    .option('--archived', 'Include tasks/done and tasks/failed', false)
    .action(async (cmdOpts: { status?: string; queue?: string; archived: boolean }) => {
      try {
        const v = openVault();
        const results = await listTasks(v, {
          status: cmdOpts.status as TaskStatus | undefined,
          queue: cmdOpts.queue as TaskQueue | undefined,
          includeArchived: cmdOpts.archived,
        });
        if (program.opts().json) {
          output(results, { json: true });
          return;
        }
        if (!results.length) {
          console.log('No tasks found.');
          return;
        }
        printTable(
          ['ID', 'Status', 'Priority', 'Queue', 'Title'],
          results.map(t => [t.taskId, t.status, t.priority, t.queue, t.title]),
        );
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  queue
    .command('create <title>')
    .description('Create a task file in tasks/agent or tasks/human')
    .requiredOption('--queue <q>', 'agent | human')
    .requiredOption('--description <text>', 'What needs to be done')
    .option('--priority <p>', 'critical | high | medium | low', 'medium')
    .option('--product <name>', 'Product/project this belongs to')
    .option('--context <paths...>', 'Vault-relative files the worker should read first')
    .action(async (title: string, cmdOpts: { queue: string; description: string; priority: string; product?: string; context?: string[] }) => {
      try {
        const v = openVault();
        const task = createTask(v, {
          title,
          queue: cmdOpts.queue as TaskQueue,
          description: cmdOpts.description,
          priority: cmdOpts.priority as TaskPriority,
          product: cmdOpts.product,
          contextFiles: cmdOpts.context,
        });
        if (program.opts().json) output(task, { json: true });
        else printSuccess(`Created ${task.taskId} → ${task.path}`);
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  queue
    .command('claim <taskId>')
    .description('Atomically claim a pending task')
    .option('--agent <id>', 'Claiming agent id', 'cli')
    .action(async (taskId: string, cmdOpts: { agent: string }) => {
      try {
        const v = openVault();
        const task = await claimTask(v, taskId, cmdOpts.agent);
        if (program.opts().json) output(task, { json: true });
        else printSuccess(`Claimed ${task.taskId} (context: ${task.contextFiles.join(', ') || 'none'})`);
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  queue
    .command('complete <taskId>')
    .description('Mark a task done/failed and archive it')
    .option('--outcome <o>', 'done | failed', 'done')
    .option('--notes <text>', 'Completion/failure notes')
    .action(async (taskId: string, cmdOpts: { outcome: string; notes?: string }) => {
      try {
        const v = openVault();
        const task = await completeTask(v, taskId, cmdOpts.outcome as 'done' | 'failed', cmdOpts.notes);
        if (program.opts().json) output(task, { json: true });
        else printSuccess(`${task.taskId} → ${task.status} (${task.path})`);
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });
}
