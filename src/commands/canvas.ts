import { Command } from 'commander';
import { Vault } from '../vault.js';
import { getVaultPath } from '../config.js';
import { output, printTable, printError, printSuccess } from '../utils/output.js';
import { randomBytes } from 'node:crypto';

interface CanvasNode {
  id: string;
  type: 'text' | 'file' | 'link' | 'group';
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  file?: string;
  url?: string;
}

interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: string;
  toSide?: string;
}

interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

function nodePreview(node: CanvasNode): string {
  if (node.text) return node.text.substring(0, 50).replace(/\n/g, ' ');
  if (node.file) return node.file;
  if (node.url) return node.url;
  return '';
}

export function registerCanvasCommands(program: Command): void {
  const canvas = program
    .command('canvas')
    .description('Manage canvas files');

  canvas
    .command('list')
    .description('List all canvas files')
    .action(async () => {
      const opts = program.opts();
      const jsonMode = opts.json;

      try {
        const vaultPath = getVaultPath(opts.vault);
        const v = new Vault(vaultPath);

        if (!v.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        const files = await v.listFiles('**/*.canvas');

        if (jsonMode) {
          output(files, { json: true });
          return;
        }

        if (files.length === 0) {
          console.log('No canvas files found.');
          return;
        }

        const rows = files.map(f => [f]);
        printTable(['Canvas File'], rows);
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  canvas
    .command('read <path>')
    .description('Read and summarize a canvas file')
    .action(async (filePath: string) => {
      const opts = program.opts();
      const jsonMode = opts.json;

      try {
        const vaultPath = getVaultPath(opts.vault);
        const v = new Vault(vaultPath);

        if (!v.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        if (!v.fileExists(filePath)) {
          printError(`Canvas file not found: ${filePath}`);
          process.exit(1);
        }

        const raw = v.readFileRaw(filePath);
        const data: CanvasData = JSON.parse(raw);

        if (jsonMode) {
          output(data, { json: true });
          return;
        }

        // Count nodes by type
        const typeCounts: Record<string, number> = {};
        for (const node of data.nodes) {
          typeCounts[node.type] = (typeCounts[node.type] || 0) + 1;
        }

        console.log(`Canvas: ${filePath}`);
        console.log(`Nodes: ${data.nodes.length}`);
        for (const [type, count] of Object.entries(typeCounts)) {
          console.log(`  ${type}: ${count}`);
        }
        console.log(`Edges: ${data.edges.length}`);

        // Text node previews
        const textNodes = data.nodes.filter(n => n.type === 'text' && n.text);
        if (textNodes.length > 0) {
          console.log('\nText node previews:');
          for (const node of textNodes) {
            console.log(`  [${node.id}] ${nodePreview(node)}`);
          }
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  canvas
    .command('create <path>')
    .description('Create a new canvas file')
    .option('--text <content>', 'Initial text node content')
    .action(async (filePath: string, cmdOpts: { text?: string }) => {
      const opts = program.opts();

      try {
        const vaultPath = getVaultPath(opts.vault);
        const v = new Vault(vaultPath);

        if (!v.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        if (v.fileExists(filePath)) {
          printError(`Canvas file already exists: ${filePath}`);
          process.exit(1);
        }

        const data: CanvasData = { nodes: [], edges: [] };

        if (cmdOpts.text) {
          data.nodes.push({
            id: randomBytes(8).toString('hex'),
            type: 'text',
            x: 0,
            y: 0,
            width: 400,
            height: 200,
            text: cmdOpts.text,
          });
        }

        v.writeFile(filePath, JSON.stringify(data, null, 2));
        printSuccess(`Canvas created: ${filePath}`);
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  canvas
    .command('nodes <path>')
    .description('List all nodes in a canvas file')
    .action(async (filePath: string) => {
      const opts = program.opts();
      const jsonMode = opts.json;

      try {
        const vaultPath = getVaultPath(opts.vault);
        const v = new Vault(vaultPath);

        if (!v.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        if (!v.fileExists(filePath)) {
          printError(`Canvas file not found: ${filePath}`);
          process.exit(1);
        }

        const raw = v.readFileRaw(filePath);
        const data: CanvasData = JSON.parse(raw);

        if (jsonMode) {
          output(data.nodes, { json: true });
          return;
        }

        if (data.nodes.length === 0) {
          console.log('No nodes found.');
          return;
        }

        const rows = data.nodes.map(node => [node.id, node.type, nodePreview(node)]);

        printTable(['ID', 'Type', 'Preview'], rows);
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });
}
