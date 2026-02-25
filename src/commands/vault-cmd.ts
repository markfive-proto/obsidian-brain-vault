import { Command } from 'commander';
import { basename, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { Vault } from '../vault.js';
import { getVaultPath, readConfig, writeConfig, getConfigValue, setConfigValue } from '../config.js';
import { output, printTable, printError, printSuccess, printWarning, formatBytes } from '../utils/output.js';
import { detectVaults } from '../utils/detect.js';

export function registerVaultCommands(program: Command): void {
  const vault = program
    .command('vault')
    .description('Vault information and configuration')
    .addHelpText('after', `
Examples:
  $ obs vault info
  $ obs vault stats
  $ obs vault config defaultVault /path/to/vault
  $ obs vault config defaultVault
  $ obs vault stats --json | jq '.fileCount'`);

  vault
    .command('info')
    .description('Show vault information')
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

        const name = basename(vaultPath);
        const files = await v.listFiles();
        const fileCount = files.length;

        // Find last modified file
        let lastModified: Date | null = null;
        let lastModifiedFile: string | null = null;
        for (const file of files) {
          try {
            const stat = v.fileStat(file);
            if (!lastModified || stat.mtime > lastModified) {
              lastModified = stat.mtime;
              lastModifiedFile = file;
            }
          } catch {
            // skip inaccessible files
          }
        }

        // Read plugin configs
        const corePlugins = v.readObsidianConfig<Record<string, boolean>>('core-plugins.json');
        const communityPlugins = v.readObsidianConfig<string[]>('community-plugins.json');

        const enabledCorePlugins = corePlugins
          ? Object.entries(corePlugins).filter(([, enabled]) => enabled).map(([plugin]) => plugin)
          : [];
        const enabledCommunityPlugins = communityPlugins ?? [];

        if (jsonMode) {
          output({
            name,
            path: vaultPath,
            fileCount,
            lastModified: lastModified?.toISOString() ?? null,
            lastModifiedFile,
            corePlugins: enabledCorePlugins,
            communityPlugins: enabledCommunityPlugins,
          }, { json: true });
        } else {
          console.log(`Vault: ${name}`);
          console.log(`Path: ${vaultPath}`);
          console.log(`Files: ${fileCount}`);
          console.log(`Last modified: ${lastModified ? lastModified.toLocaleString() : 'N/A'}${lastModifiedFile ? ` (${lastModifiedFile})` : ''}`);
          for (const [label, list] of [['Core plugins', enabledCorePlugins], ['Community plugins', enabledCommunityPlugins]] as const) {
            console.log(`\n${label} (${list.length}):`);
            console.log(`  ${list.length > 0 ? list.join(', ') : '(none)'}`);
          }
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  vault
    .command('stats')
    .description('Show vault statistics')
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

        const stats = await v.getStats();

        // Gather tag distribution from markdown files
        const mdFiles = await v.listFiles('**/*.md');
        const tagCounts: Record<string, number> = {};
        for (const file of mdFiles) {
          try {
            const parsed = v.readFile(file);
            // Tags from frontmatter
            const fmTags = parsed.frontmatter.tags;
            if (Array.isArray(fmTags)) {
              for (const tag of fmTags) {
                const t = String(tag);
                tagCounts[t] = (tagCounts[t] || 0) + 1;
              }
            } else if (typeof fmTags === 'string') {
              tagCounts[fmTags] = (tagCounts[fmTags] || 0) + 1;
            }

            // Inline tags (#tag)
            const inlineTags = parsed.body.match(/(?:^|\s)#([a-zA-Z_][\w/-]*)/g);
            if (inlineTags) {
              for (const match of inlineTags) {
                const tag = match.trim().slice(1); // remove #
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
              }
            }
          } catch {
            // skip unreadable files
          }
        }

        // Sort tags by count descending, take top 20
        const sortedTags = Object.entries(tagCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20);

        if (jsonMode) {
          output({
            fileCount: stats.fileCount,
            folderCount: stats.folderCount,
            totalSize: stats.totalSize,
            totalSizeFormatted: formatBytes(stats.totalSize),
            byExtension: stats.byExtension,
            topTags: Object.fromEntries(sortedTags),
          }, { json: true });
        } else {
          console.log(`Total files: ${stats.fileCount}`);
          console.log(`Total folders: ${stats.folderCount}`);
          console.log(`Total size: ${formatBytes(stats.totalSize)}`);

          // Extension table
          const extRows = Object.entries(stats.byExtension)
            .sort((a, b) => b[1] - a[1])
            .map(([ext, count]) => [ext, count]);
          console.log('\nFiles by extension:');
          printTable(['Extension', 'Count'], extRows);

          // Tag distribution
          if (sortedTags.length > 0) {
            console.log('\nTop tags:');
            printTable(['Tag', 'Count'], sortedTags);
          }
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  vault
    .command('wordcount')
    .description('Word count across vault files')
    .option('--file <path>', 'Count words in a single file')
    .option('--top <n>', 'Show top N files by word count', parseInt)
    .action(async (cmdOpts: { file?: string; top?: number }) => {
      const opts = program.opts();
      const jsonMode = opts.json;

      try {
        const vaultPath = getVaultPath(opts.vault);
        const v = new Vault(vaultPath);

        if (!v.isValid()) {
          printError(`Not a valid Obsidian vault: ${vaultPath}`);
          process.exit(1);
        }

        const countWords = (text: string): number => {
          // Strip frontmatter
          const body = text.replace(/^---[\s\S]*?---\n?/, '');
          const words = body.match(/\S+/g);
          return words ? words.length : 0;
        };

        if (cmdOpts.file) {
          if (!v.fileExists(cmdOpts.file)) {
            printError(`File not found: ${cmdOpts.file}`);
            process.exit(1);
          }
          const raw = v.readFileRaw(cmdOpts.file);
          const count = countWords(raw);
          if (jsonMode) {
            output({ file: cmdOpts.file, words: count }, { json: true });
          } else {
            console.log(`${cmdOpts.file}: ${count.toLocaleString()} words`);
          }
          return;
        }

        const mdFiles = await v.listFiles('**/*.md');
        const fileCounts: Array<{ file: string; words: number }> = [];
        let totalWords = 0;

        for (const file of mdFiles) {
          try {
            const raw = v.readFileRaw(file);
            const count = countWords(raw);
            fileCounts.push({ file, words: count });
            totalWords += count;
          } catch {
            // skip unreadable files
          }
        }

        // Sort by word count descending
        fileCounts.sort((a, b) => b.words - a.words);

        const limited = cmdOpts.top ? fileCounts.slice(0, cmdOpts.top) : fileCounts;

        if (jsonMode) {
          output({ totalWords, fileCount: fileCounts.length, files: limited }, { json: true });
        } else {
          if (cmdOpts.top) {
            console.log(`Top ${Math.min(cmdOpts.top, fileCounts.length)} files by word count:\n`);
            printTable(
              ['File', 'Words'],
              limited.map(f => [f.file, f.words.toLocaleString()]),
            );
            console.log(`\nTotal: ${totalWords.toLocaleString()} words across ${fileCounts.length} files`);
          } else {
            console.log(`Total: ${totalWords.toLocaleString()} words across ${fileCounts.length} files`);
          }
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  vault
    .command('config [key] [value]')
    .description('Get or set CLI configuration values')
    .action((key?: string, value?: string) => {
      const opts = program.opts();
      const jsonMode = opts.json;

      try {
        if (!key) {
          // Print entire config
          const config = readConfig();
          output(config, { json: jsonMode });
          return;
        }

        if (!value) {
          // Print specific key
          const val = getConfigValue(key) ?? null;
          if (jsonMode) {
            output({ [key]: val }, { json: true });
          } else if (val === null) {
            console.log(`${key}: (not set)`);
          } else {
            const display = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val);
            console.log(`${key}: ${display}`);
          }
          return;
        }

        // Set key=value
        // Special case: validate defaultVault path
        if (key === 'defaultVault') {
          const resolvedPath = resolve(value);
          if (!existsSync(resolvedPath)) {
            printError(`Path does not exist: ${resolvedPath}`);
            process.exit(1);
          }
          setConfigValue(key, resolvedPath);
          printSuccess(`Set ${key} = ${resolvedPath}`);
        } else {
          setConfigValue(key, value);
          printSuccess(`Set ${key} = ${value}`);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  vault
    .command('add <name> <path>')
    .description('Register a vault in the CLI config')
    .action((name: string, vaultPath: string) => {
      try {
        const resolvedPath = resolve(vaultPath);
        if (!existsSync(resolvedPath)) {
          printError(`Path does not exist: ${resolvedPath}`);
          process.exit(1);
        }
        if (!existsSync(resolve(resolvedPath, '.obsidian'))) {
          printError(`Not a valid Obsidian vault (no .obsidian/ directory): ${resolvedPath}`);
          process.exit(1);
        }

        const config = readConfig();
        config.vaults[name] = { name, path: resolvedPath };
        writeConfig(config);
        printSuccess(`Vault "${name}" registered at ${resolvedPath}`);
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  vault
    .command('list')
    .description('List all registered and detected vaults')
    .action(async () => {
      const opts = program.opts();
      const jsonMode = opts.json;

      try {
        const config = readConfig();
        const registered = config.vaults;
        const detected = await detectVaults();

        const registeredPaths = new Set(
          Object.values(registered).map(v => resolve(v.path))
        );

        if (jsonMode) {
          output({
            registered: Object.entries(registered).map(([key, v]) => ({
              key,
              name: v.name,
              path: v.path,
              default: config.defaultVault === v.path,
            })),
            detected: detected
              .filter(d => !registeredPaths.has(d.path))
              .map(d => ({ name: d.name, path: d.path, source: d.source })),
          }, { json: true });
          return;
        }

        console.log('Registered vaults:\n');
        const entries = Object.entries(registered);
        if (entries.length === 0) {
          console.log('  (none)\n');
        } else {
          for (const [key, v] of entries) {
            const isDefault = config.defaultVault === v.path;
            const marker = isDefault ? ' (default)' : '';
            console.log(`  ${key}: ${v.path}${marker}`);
          }
          console.log();
        }

        const unregistered = detected.filter(d => !registeredPaths.has(d.path));
        if (unregistered.length > 0) {
          console.log('Auto-detected (not yet registered):\n');
          for (const v of unregistered) {
            const src = v.source === 'obsidian-config' ? 'Obsidian config' : 'filesystem';
            console.log(`  ${v.name}: ${v.path} [${src}]`);
          }
          console.log();
        }
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  vault
    .command('switch <name>')
    .description('Set the default vault by name')
    .action((name: string) => {
      try {
        const config = readConfig();
        const entry = config.vaults[name];
        if (!entry) {
          printError(`Vault "${name}" is not registered. Use "obs vault list" to see available vaults.`);
          process.exit(1);
        }
        config.defaultVault = entry.path;
        writeConfig(config);
        printSuccess(`Default vault set to "${name}" (${entry.path})`);
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });

  vault
    .command('remove <name>')
    .description('Remove a vault from the CLI config')
    .action((name: string) => {
      try {
        const config = readConfig();
        const entry = config.vaults[name];
        if (!entry) {
          printError(`Vault "${name}" is not registered.`);
          process.exit(1);
        }

        const wasDefault = config.defaultVault === entry.path;
        delete config.vaults[name];

        if (wasDefault) {
          delete config.defaultVault;
          printWarning(`"${name}" was the default vault. Default has been cleared.`);
        }

        writeConfig(config);
        printSuccess(`Vault "${name}" removed.`);
      } catch (err) {
        printError((err as Error).message);
        process.exit(1);
      }
    });
}
