import { Command } from 'commander';
import { createInterface } from 'node:readline/promises';
import { resolve, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { readConfig, writeConfig } from '../config.js';
import { detectVaults, DetectedVault } from '../utils/detect.js';
import { printError, printSuccess } from '../utils/output.js';

async function askQuestion(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(prompt);
    return answer.trim();
  } finally {
    rl.close();
  }
}

function sourceLabel(source: string): string {
  return source === 'obsidian-config' ? 'from Obsidian config' : 'found on filesystem';
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Interactive setup wizard for obsidian-vault-cli')
    .action(async () => {
      console.log('\nWelcome to obs (obsidian-vault-cli)! Let\'s set up your vault.\n');

      let selectedPath: string | null = null;

      const detected = await detectVaults();

      if (detected.length > 0) {
        console.log('Detected vaults:\n');
        for (let i = 0; i < detected.length; i++) {
          const v = detected[i];
          console.log(`  [${i + 1}] ${v.name} (${v.path}) [${sourceLabel(v.source)}]`);
        }
        console.log();

        const choice = await askQuestion(
          `Pick a vault (1-${detected.length}), or enter a custom path: `
        );

        const num = parseInt(choice, 10);
        if (num >= 1 && num <= detected.length) {
          selectedPath = detected[num - 1].path;
        } else if (choice.length > 0) {
          selectedPath = resolve(choice);
        }
      } else {
        console.log('No vaults detected automatically.\n');
        const customPath = await askQuestion('Enter the path to your Obsidian vault: ');
        if (customPath.length > 0) {
          selectedPath = resolve(customPath);
        }
      }

      if (!selectedPath) {
        printError('No vault path provided. Aborting.');
        process.exit(1);
      }

      // Validate
      if (!existsSync(selectedPath)) {
        printError(`Path does not exist: ${selectedPath}`);
        process.exit(1);
      }

      const obsidianDir = resolve(selectedPath, '.obsidian');
      if (!existsSync(obsidianDir)) {
        printError(
          `Not a valid Obsidian vault (no .obsidian/ directory found): ${selectedPath}`
        );
        process.exit(1);
      }

      // Ask about default
      const setDefault = await askQuestion('Set as default vault? (Y/n) ');
      const isDefault = setDefault === '' || setDefault.toLowerCase().startsWith('y');

      // Save to config
      const config = readConfig();
      const vaultName = basename(selectedPath);

      config.vaults[vaultName] = {
        name: vaultName,
        path: selectedPath,
      };

      if (isDefault) {
        config.defaultVault = selectedPath;
      }

      writeConfig(config);

      console.log();
      printSuccess(`Vault "${vaultName}" registered at ${selectedPath}`);
      if (isDefault) {
        printSuccess(`Set as default vault.`);
      }
      console.log('\nVault configured! Try: obs vault info\n');
    });
}
