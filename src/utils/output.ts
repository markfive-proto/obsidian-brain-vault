import chalk from 'chalk';
import Table from 'cli-table3';

export function output(data: unknown, opts?: { json?: boolean }): void {
  if (typeof data === 'string' && !opts?.json) {
    console.log(data);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

export function printTable(headers: string[], rows: (string | number)[][]): void {
  const table = new Table({
    head: headers.map(h => chalk.bold(h)),
    style: { head: [], border: [] },
  });
  for (const row of rows) {
    table.push(row.map(String));
  }
  console.log(table.toString());
}

export function printError(msg: string): void {
  console.error(chalk.red('Error: ') + msg);
}

export function printSuccess(msg: string): void {
  console.log(chalk.green('✓ ') + msg);
}

export function printWarning(msg: string): void {
  console.log(chalk.yellow('⚠ ') + msg);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
