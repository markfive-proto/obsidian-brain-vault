import matter from 'gray-matter';

export function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  const { data, content } = matter(raw);
  return { data, body: content };
}

export function serializeFrontmatter(data: Record<string, unknown>, body: string): string {
  const hasData = Object.keys(data).length > 0;
  if (!hasData) return body.startsWith('\n') ? body.slice(1) : body;
  return matter.stringify(body, data);
}

export function updateFrontmatter(raw: string, updates: Record<string, unknown>): string {
  const { data, body } = parseFrontmatter(raw);
  const merged = { ...data, ...updates };
  // Remove keys set to undefined
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) delete merged[key];
  }
  return serializeFrontmatter(merged, body);
}
