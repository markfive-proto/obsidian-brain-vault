#!/usr/bin/env node
import { Command } from 'commander';
import { registerAllCommands } from './commands/index.js';

const program = new Command();

program
  .name('obs')
  .description('Open-source CLI for Obsidian vaults — works alongside kepano/obsidian-skills')
  .version('0.1.0')
  .option('--vault <path>', 'Path to Obsidian vault')
  .option('--json', 'Output as JSON');

registerAllCommands(program);

program.parse();
