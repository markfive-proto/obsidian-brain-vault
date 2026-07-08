import matter from 'gray-matter';
import { Vault } from '../vault.js';
import { extractWikilinks, resolveWikilink } from '../utils/markdown.js';

/**
 * Typed-edge entity graph, computed from what notes already contain — zero
 * LLM calls. Two edge sources:
 *
 *  1. Frontmatter fields mapped to edge types (a person page's `org:` field
 *     becomes a works_at edge; `related:` becomes related_to, etc.)
 *  2. Body wikilinks, which become generic `mentions` edges
 *
 * The frontmatter mapping idea is adapted from Garry Tan's gbrain
 * (https://github.com/garrytan/gbrain, MIT, © 2026 Garry Tan) —
 * src/core/link-extraction.ts FRONTMATTER_LINK_MAP.
 */

export type EdgeType =
  | 'works_at'
  | 'founded'
  | 'invested_in'
  | 'advises'
  | 'related_to'
  | 'derived_from'
  | 'mentions';

export interface TypedEdge {
  from: string;        // vault-relative path
  to: string;          // vault-relative path
  type: EdgeType;
  source: 'frontmatter' | 'wikilink';
  field?: string;      // frontmatter field the edge came from
}

interface FieldMapping {
  fields: string[];         // frontmatter keys to read
  type: EdgeType;
  pageTypes?: string[];     // only apply when the note's `type:` matches
}

const FRONTMATTER_LINK_MAP: FieldMapping[] = [
  { fields: ['org', 'company', 'employer', 'affiliation'], type: 'works_at', pageTypes: ['person'] },
  { fields: ['founded', 'founder_of'], type: 'founded', pageTypes: ['person'] },
  { fields: ['founders', 'founded_by'], type: 'founded' },          // org page pointing at people (reversed below)
  { fields: ['invested_in', 'investments'], type: 'invested_in' },
  { fields: ['advises', 'advisor_of'], type: 'advises' },
  { fields: ['related', 'see_also', 'related_to'], type: 'related_to' },
  { fields: ['sources', 'source', 'derived_from', 'rendered_from'], type: 'derived_from' },
];

/** Fields whose edges point INTO the note (e.g. an org's `founders:` list). */
const REVERSED_FIELDS = new Set(['founders', 'founded_by']);

/** Strip [[...]] and |alias to get a resolvable link target. */
function cleanTarget(value: string): string {
  let v = value.trim().replace(/^\[\[/, '').replace(/\]\]$/, '');
  const pipe = v.indexOf('|');
  if (pipe !== -1) v = v.slice(0, pipe);
  return v.replace(/#.*$/, '').trim();
}

function fieldValues(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) return raw.map(String).map(s => s.trim()).filter(Boolean);
  if (typeof raw === 'string') return raw.trim() ? [raw.trim()] : [];
  return [];
}

export interface GraphIndex {
  edges: TypedEdge[];
  /** adjacency both ways: path -> edges touching it */
  byNode: Map<string, TypedEdge[]>;
}

/**
 * Extract the typed-edge graph for the whole vault. External URLs and
 * unresolvable targets are skipped — only vault-internal edges count.
 */
export async function extractTypedEdges(vault: Vault): Promise<GraphIndex> {
  const allFiles = await vault.listFiles('**/*.md');
  const edges: TypedEdge[] = [];
  const seen = new Set<string>();

  const resolve = (target: string): string | null => {
    if (/^https?:\/\//i.test(target)) return null;
    return resolveWikilink(cleanTarget(target).replace(/\.md$/, ''), allFiles);
  };

  const push = (edge: TypedEdge) => {
    const key = `${edge.from}→${edge.to}:${edge.type}`;
    if (seen.has(key) || edge.from === edge.to) return;
    seen.add(key);
    edges.push(edge);
  };

  for (const file of allFiles) {
    let raw: string;
    try { raw = vault.readFileRaw(file); } catch { continue; }
    const { data, content } = matter(raw);
    const pageType = typeof data.type === 'string' ? data.type : undefined;

    for (const mapping of FRONTMATTER_LINK_MAP) {
      if (mapping.pageTypes && (!pageType || !mapping.pageTypes.includes(pageType))) continue;
      for (const field of mapping.fields) {
        for (const value of fieldValues(data[field])) {
          const resolved = resolve(value);
          if (!resolved) continue;
          const reversed = REVERSED_FIELDS.has(field);
          push({
            from: reversed ? resolved : file,
            to: reversed ? file : resolved,
            type: mapping.type,
            source: 'frontmatter',
            field,
          });
        }
      }
    }

    for (const link of extractWikilinks(content)) {
      const resolved = resolve(link.target);
      if (!resolved) continue;
      push({ from: file, to: resolved, type: 'mentions', source: 'wikilink' });
    }
  }

  const byNode = new Map<string, TypedEdge[]>();
  for (const e of edges) {
    for (const node of [e.from, e.to]) {
      const arr = byNode.get(node) ?? [];
      arr.push(e);
      byNode.set(node, arr);
    }
  }
  return { edges, byNode };
}

// ---- traversal ----------------------------------------------------------------

export interface TraverseOptions {
  depth?: number;                          // max hops (default 2)
  types?: EdgeType[];                      // edge-type filter
  direction?: 'out' | 'in' | 'both';       // default both
}

export interface TraverseHit {
  path: string;
  distance: number;
  via: Array<{ from: string; to: string; type: EdgeType }>;  // edge chain from start
}

/**
 * BFS over the typed-edge graph from a start note. Returns reachable notes
 * with the edge chain that got there.
 */
export async function traverseGraph(
  vault: Vault,
  start: string,
  opts: TraverseOptions = {},
): Promise<{ start: string; hits: TraverseHit[] }> {
  const depth = opts.depth ?? 2;
  const direction = opts.direction ?? 'both';
  const allFiles = await vault.listFiles('**/*.md');
  const startFile = allFiles.includes(start)
    ? start
    : resolveWikilink(start.replace(/\.md$/, ''), allFiles);
  if (!startFile) throw new Error(`Note not found: ${start}`);

  const { byNode } = await extractTypedEdges(vault);
  const typeOk = (t: EdgeType) => !opts.types || opts.types.includes(t);

  const visited = new Set<string>([startFile]);
  const hits: TraverseHit[] = [];
  let frontier: TraverseHit[] = [{ path: startFile, distance: 0, via: [] }];

  for (let d = 1; d <= depth; d++) {
    const next: TraverseHit[] = [];
    for (const node of frontier) {
      for (const edge of byNode.get(node.path) ?? []) {
        if (!typeOk(edge.type)) continue;
        let neighbor: string | null = null;
        if (edge.from === node.path && direction !== 'in') neighbor = edge.to;
        else if (edge.to === node.path && direction !== 'out') neighbor = edge.from;
        if (!neighbor || visited.has(neighbor)) continue;
        visited.add(neighbor);
        const hit: TraverseHit = {
          path: neighbor,
          distance: d,
          via: [...node.via, { from: edge.from, to: edge.to, type: edge.type }],
        };
        hits.push(hit);
        next.push(hit);
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }

  return { start: startFile, hits };
}
