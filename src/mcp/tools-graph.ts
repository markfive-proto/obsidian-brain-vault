import { z } from 'zod';
import type { ZodRawShape } from 'zod';
import { defineTool, type ToolDef } from './registry.js';
import { traverseGraph, extractTypedEdges, type EdgeType } from '../kb/graph.js';

const EDGE_TYPES = ['works_at', 'founded', 'invested_in', 'advises', 'related_to', 'derived_from', 'mentions'] as const;

const graphTraverse = defineTool({
  name: 'obs_graph_traverse',
  description: 'Traverse the typed-edge knowledge graph from a note (edges from frontmatter like org/founded/related plus body wikilinks). Answers "what is connected to X and how".',
  scope: 'read',
  schema: {
    start: z.string().describe('Note path or name to start from'),
    depth: z.number().int().min(1).max(4).optional().describe('Max hops (default 2)'),
    types: z.array(z.enum(EDGE_TYPES)).optional().describe('Only follow these edge types'),
    direction: z.enum(['out', 'in', 'both']).optional().describe('Edge direction to follow (default both)'),
  },
  handler: async ({ start, depth, types, direction }, ctx) => {
    const result = await traverseGraph(ctx.vault, start, { depth, types: types as EdgeType[] | undefined, direction });
    return {
      start: result.start,
      reachable: result.hits.length,
      hits: result.hits.slice(0, 100).map(h => ({
        path: h.path,
        distance: h.distance,
        via: h.via.map(e => `${e.from} —${e.type}→ ${e.to}`),
      })),
    };
  },
});

const graphEdges = defineTool({
  name: 'obs_graph_edges',
  description: 'List typed edges for one note (or vault-wide counts by type). Edge types: works_at, founded, invested_in, advises, related_to, derived_from, mentions.',
  scope: 'read',
  schema: {
    path: z.string().optional().describe('Note path or name — omit for vault-wide edge-type counts'),
  },
  handler: async ({ path }, ctx) => {
    const { edges, byNode } = await extractTypedEdges(ctx.vault);
    if (!path) {
      const counts: Record<string, number> = {};
      for (const e of edges) counts[e.type] = (counts[e.type] ?? 0) + 1;
      return { totalEdges: edges.length, byType: counts };
    }
    const allFiles = await ctx.vault.listFiles('**/*.md');
    const { resolveWikilink } = await import('../utils/markdown.js');
    const resolved = allFiles.includes(path) ? path : resolveWikilink(path.replace(/\.md$/, ''), allFiles);
    if (!resolved) throw new Error(`Note not found: ${path}`);
    const touching = byNode.get(resolved) ?? [];
    return {
      path: resolved,
      outgoing: touching.filter(e => e.from === resolved).map(e => ({ to: e.to, type: e.type, field: e.field })),
      incoming: touching.filter(e => e.to === resolved).map(e => ({ from: e.from, type: e.type, field: e.field })),
    };
  },
});

export const graphTools: Array<ToolDef<ZodRawShape>> = [
  graphTraverse,
  graphEdges,
] as unknown as Array<ToolDef<ZodRawShape>>;
