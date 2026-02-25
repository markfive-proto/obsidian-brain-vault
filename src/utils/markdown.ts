/**
 * Extract wikilinks from markdown content.
 * Handles: [[Target]], [[Target|Alias]], [[Target#Heading]], [[Target#^block-id]]
 */
export function extractWikilinks(content: string): Array<{ target: string; alias?: string; heading?: string; blockRef?: string }> {
  const results: Array<{ target: string; alias?: string; heading?: string; blockRef?: string }> = [];
  const regex = /\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;

  const lines = content.split('\n');
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    regex.lastIndex = 0;
    while ((match = regex.exec(line)) !== null) {
      const inner = match[1];
      let target = inner;
      let alias: string | undefined;
      let heading: string | undefined;
      let blockRef: string | undefined;

      // Handle alias: [[Target|Alias]]
      const pipeIdx = inner.indexOf('|');
      if (pipeIdx !== -1) {
        target = inner.slice(0, pipeIdx);
        alias = inner.slice(pipeIdx + 1);
      }

      // Handle block ref: [[Target#^block-id]]
      const blockIdx = target.indexOf('#^');
      if (blockIdx !== -1) {
        blockRef = target.slice(blockIdx + 2);
        target = target.slice(0, blockIdx);
      } else {
        // Handle heading: [[Target#Heading]]
        const headingIdx = target.indexOf('#');
        if (headingIdx !== -1) {
          heading = target.slice(headingIdx + 1);
          target = target.slice(0, headingIdx);
        }
      }

      results.push({ target, alias, heading, blockRef });
    }
  }

  return results;
}

/**
 * Extract markdown links: [text](url)
 */
export function extractMarkdownLinks(content: string): Array<{ text: string; url: string }> {
  const results: Array<{ text: string; url: string }> = [];
  const regex = /\[([^\]]*)\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  const lines = content.split('\n');
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    regex.lastIndex = 0;
    while ((match = regex.exec(line)) !== null) {
      results.push({ text: match[1], url: match[2] });
    }
  }

  return results;
}

/**
 * Extract inline tags (#tag) from content.
 * Skips code blocks and headings.
 */
export function extractInlineTags(content: string): string[] {
  const tags = new Set<string>();
  const lines = content.split('\n');
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;
    // Skip headings
    if (line.trimStart().startsWith('#') && line.trimStart().match(/^#{1,6}\s/)) continue;

    const regex = /(?:^|\s)#([a-zA-Z0-9_/\-]+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line)) !== null) {
      tags.add(match[1]);
    }
  }

  return Array.from(tags);
}

/**
 * Extract tasks (checkbox items) from content.
 */
export function extractTasks(content: string): Array<{ text: string; done: boolean; line: number }> {
  const tasks: Array<{ text: string; done: boolean; line: number }> = [];
  const lines = content.split('\n');
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const unchecked = line.match(/^(\s*[-*+]\s)\[ \]\s(.+)/);
    if (unchecked) {
      tasks.push({ text: unchecked[2], done: false, line: i + 1 });
      continue;
    }
    const checked = line.match(/^(\s*[-*+]\s)\[x\]\s(.+)/i);
    if (checked) {
      tasks.push({ text: checked[2], done: true, line: i + 1 });
    }
  }

  return tasks;
}

/**
 * Resolve a wikilink target to a file path using case-insensitive basename matching.
 * If ambiguous, returns shortest path.
 */
export function resolveWikilink(target: string, allFiles: string[]): string | null {
  if (!target) return null;

  // Exact match first
  const exact = allFiles.find(f => f === target + '.md' || f === target);
  if (exact) return exact;

  // Case-insensitive basename match
  const targetLower = target.toLowerCase();
  const matches = allFiles.filter(f => {
    const base = f.replace(/\.md$/, '');
    const baseName = base.split('/').pop()!.toLowerCase();
    return baseName === targetLower || base.toLowerCase() === targetLower;
  });

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  // Shortest path for disambiguation
  return matches.sort((a, b) => a.length - b.length)[0];
}
