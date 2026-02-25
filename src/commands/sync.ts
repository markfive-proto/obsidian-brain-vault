import { Command } from 'commander';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Vault } from '../vault.js';
import { getVaultPath } from '../config.js';
import { output, printError, printSuccess } from '../utils/output.js';

const execFileAsync = promisify(execFile);

export function registerSyncCommands(program: Command): void {
  const sync = program
    .command('sync')
    .description('Git sync operations for the vault');

  sync
    .command('status')
    .description('Show git status of the vault')
    .action(async () => {
      const programOpts = program.opts();

      try {
        const vaultPath = getVaultPath(programOpts.vault);
        const vault = new Vault(vaultPath);

        if (!vault.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        const { stdout } = await execFileAsync('git', ['status'], {
          cwd: vault.path,
        });

        output(stdout.trim());
      } catch (err) {
        const message = (err as Error).message;
        if (message.includes('not a git repository') || message.includes('fatal')) {
          output('Not a git repository');
        } else {
          printError(message);
          process.exit(1);
        }
      }
    });

  sync
    .command('push')
    .description('Stage, commit, and push vault changes')
    .option('--message <msg>', 'Commit message')
    .action(async (opts) => {
      const programOpts = program.opts();

      try {
        const vaultPath = getVaultPath(programOpts.vault);
        const vault = new Vault(vaultPath);

        if (!vault.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        const cwd = vault.path;
        const message = opts.message || `vault sync ${new Date().toISOString()}`;

        await execFileAsync('git', ['add', '-A'], { cwd });
        await execFileAsync('git', ['commit', '-m', message], { cwd });
        const { stdout } = await execFileAsync('git', ['push'], { cwd });

        printSuccess('Vault pushed successfully');
        if (stdout.trim()) {
          output(stdout.trim());
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  sync
    .command('pull')
    .description('Pull latest vault changes from remote')
    .action(async () => {
      const programOpts = program.opts();

      try {
        const vaultPath = getVaultPath(programOpts.vault);
        const vault = new Vault(vaultPath);

        if (!vault.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        const { stdout } = await execFileAsync('git', ['pull'], {
          cwd: vault.path,
        });

        printSuccess('Vault pulled successfully');
        if (stdout.trim()) {
          output(stdout.trim());
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });
}
