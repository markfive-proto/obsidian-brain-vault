import { format } from 'date-fns';
import { Vault } from '../vault.js';

/**
 * Convert Moment.js format tokens to date-fns format tokens.
 */
export function momentToDateFns(momentFormat: string): string {
  return momentFormat
    .replace(/YYYY/g, 'yyyy')
    .replace(/YY/g, 'yy')
    .replace(/DD/g, 'dd')
    .replace(/dddd/g, 'EEEE')
    .replace(/ddd/g, 'EEE');
}

export function getTemplatesFolder(vault: Vault): string {
  const config = vault.readObsidianConfig<{ folder?: string }>('templates.json');
  return config?.folder ?? 'Templates';
}

export function applyTemplateVariables(content: string, title: string): string {
  const now = new Date();
  return content
    .replace(/\{\{date\}\}/g, format(now, 'yyyy-MM-dd'))
    .replace(/\{\{time\}\}/g, format(now, 'HH:mm'))
    .replace(/\{\{title\}\}/g, title)
    .replace(/\{\{date:([^}]+)\}\}/g, (_match, fmt: string) => {
      return format(now, momentToDateFns(fmt));
    });
}
