#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Vault } from '../vault.js';
import { getVaultPath } from '../config.js';
import { registerTools } from './tools.js';

const args = process.argv.slice(2);
let vaultPath: string | undefined;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--vault' && args[i + 1]) {
    vaultPath = args[i + 1];
    break;
  }
}

const resolvedPath = getVaultPath(vaultPath);
const vault = new Vault(resolvedPath);

if (!vault.isValid()) {
  console.error(`Not a valid Obsidian vault: ${resolvedPath}`);
  process.exit(1);
}

const server = new McpServer({
  name: 'obs',
  version: '0.1.0',
});

registerTools(server, vault);

const transport = new StdioServerTransport();
await server.connect(transport);
