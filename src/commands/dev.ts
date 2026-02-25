import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { createContext, runInContext, Script } from 'node:vm';
import { Vault } from '../vault.js';
import { getVaultPath } from '../config.js';
import { output, printError, printWarning } from '../utils/output.js';

export function registerDevCommands(program: Command): void {
  const dev = program
    .command('dev')
    .description('Developer tools for vault scripting');

  dev
    .command('eval <expression>')
    .description('Evaluate a JS expression with vault in scope')
    .action(async (expression: string) => {
      const programOpts = program.opts();

      try {
        const vaultPath = getVaultPath(programOpts.vault);
        const vault = new Vault(vaultPath);

        if (!vault.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        printWarning('dev eval executes arbitrary JavaScript with vault filesystem access.');
        const sandbox = { vault, console };
        const context = createContext(sandbox);
        const result = await Promise.resolve(runInContext(expression, context));
        output(result);
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  dev
    .command('script <file>')
    .description('Run a JS script file with vault context')
    .action(async (file: string) => {
      const programOpts = program.opts();

      try {
        const vaultPath = getVaultPath(programOpts.vault);
        const vault = new Vault(vaultPath);

        if (!vault.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        const code = readFileSync(file, 'utf-8');
        const sandbox = { vault, console };
        const context = createContext(sandbox);
        const script = new Script(code, { filename: file });
        await Promise.resolve(script.runInContext(context));
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });
}
