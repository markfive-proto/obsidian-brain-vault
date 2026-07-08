import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerPrompts(server: McpServer): void {
  // ── /clip — ingest a source into raw/ ───────────────────────────────────────
  server.prompt(
    'clip',
    'Ingest a URL, PDF, YouTube video, GitHub repo, or local file into the vault raw/ directory',
    { source: z.string().describe('URL or file path to ingest') },
    ({ source }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Ingest the following source into my knowledge base vault using \`obs kb ingest\`.

Source: ${source}

Steps:
1. Run \`obs kb ingest "${source}" --vault <vault>\` (use obs_kb_ingest tool).
2. Report the path written, word count, and a 2-line summary.
3. Tell me to run /compile to fold it into the wiki.

Do NOT modify compiled/ — ingest only writes to raw/.`,
          },
        },
      ],
    }),
  );

  // ── /compile — run the LLM compile step ─────────────────────────────────────
  server.prompt(
    'compile',
    'Compile new raw/ sources into the compiled/ wiki (concept pages, people, orgs, index)',
    {
      mode: z
        .enum(['incremental', 'full'])
        .optional()
        .describe('incremental (default) or full recompile'),
    },
    ({ mode }) => {
      const flag = mode === 'full' ? ' --full' : '';
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Run a ${mode ?? 'incremental'} compile of my knowledge base.

Steps:
1. Run \`obs kb compile${flag} --vault <vault>\` (use obs_kb_compile tool).
2. Report: how many raw sources were processed, new concept pages created, existing pages updated.
3. Show the top 3-5 new concepts that were added.
4. Suggest running /lint if more than 5 sources were compiled.

Write to compiled/concepts/, compiled/people/, compiled/orgs/, and rebuild compiled/00-INDEX.md.`,
            },
          },
        ],
      };
    },
  );

  // ── /ask — query the compiled wiki ──────────────────────────────────────────
  server.prompt(
    'ask',
    'Ask a question against the compiled wiki and save the answer to outputs/answers/',
    { question: z.string().describe('Your question') },
    ({ question }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Answer this question using my knowledge base vault:

Question: ${question}

Steps:
1. Run \`obs kb ask "${question}" --vault <vault>\` (use obs_kb_ask tool).
2. The answer will be saved to outputs/answers/YYYY-MM-DD-<slug>.md.
3. Show the TL;DR and tell me the file path.
4. If the vault lacks enough information, tell me what to ingest with /clip to fill the gap.

Every answer is a new note — never reply chat-only. Cite sources with [[wikilinks]].`,
          },
        },
      ],
    }),
  );

  // ── /lint — health-check the KB ─────────────────────────────────────────────
  server.prompt(
    'lint',
    'Health-check the knowledge base: broken links, orphans, missing frontmatter, gaps',
    {
      check: z
        .enum(['full', 'links', 'orphans', 'frontmatter', 'duplicates', 'gaps'])
        .optional()
        .describe('Which check to run (default: full)'),
    },
    ({ check }) => {
      const checkArg = check ? ` --check ${check}` : '';
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Run a ${check ?? 'full'} health check on my knowledge base.

Steps:
1. Run \`obs kb lint${checkArg} --vault <vault>\` (use obs_kb_lint tool).
2. Report errors / warnings / info counts.
3. List the top 5 most critical issues with suggested fixes.
4. List the top 3 "next to write" concept candidates (dangling links, frequent open questions).
5. Suggest whether a /compile run is needed first.

Write the full report to outputs/lint/YYYY-MM-DD-full.md.`,
            },
          },
        ],
      };
    },
  );

  // ── /render — render wiki content into a deliverable ────────────────────────
  server.prompt(
    'render',
    'Render knowledge-base content as slides (Marp), a brief, a chart, or a concept graph',
    {
      format: z
        .enum(['slides', 'brief', 'chart', 'graph', 'flashcards', 'handbook'])
        .describe('Output format'),
      topic: z.string().describe('Topic, concept name, or note path to render'),
    },
    ({ format, topic }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Render "${topic}" as ${format} from my knowledge base.

Steps:
1. Search compiled/ for notes related to "${topic}" (use obs_search and obs_read_note tools).
2. Generate the ${format} output:
   - slides → Marp markdown deck in outputs/slides/<slug>.md
   - brief → 1-2 page exec summary in outputs/briefs/<slug>.md
   - chart → matplotlib script + PNG in outputs/charts/<slug>.py + .png
   - graph → Mermaid concept graph in outputs/graphs/<slug>.md
   - flashcards → Anki TSV in outputs/flashcards/<slug>.tsv
   - handbook → compiled printable markdown in outputs/handbooks/<slug>.md
3. Save the file and report the path.
4. For slides: include a References slide linking back to source notes.

Every artifact gets frontmatter with type: rendered and rendered_from: [sources].`,
          },
        },
      ],
    }),
  );

  // ── /dream — run the full dream cycle manually ───────────────────────────────
  server.prompt(
    'dream',
    'Run the full nightly dream cycle: compile → lint → stats (normally runs automatically at 2am)',
    {
      dry_run: z
        .boolean()
        .optional()
        .describe('Preview what would happen without writing anything'),
    },
    ({ dry_run }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Run the ${dry_run ? 'dry-run preview of the ' : ''}dream cycle on my knowledge base.

Steps:
1. Run \`obs kb dream${dry_run ? ' --dry-run' : ''} --vault <vault>\` — it compiles a bounded batch of new raw sources, runs the health check, refreshes stale embeddings, and caches the typed-edge graph.
2. Report: sources compiled, lint errors/warnings, files re-embedded, edges cached, and anything skipped.
${
  dry_run
    ? '3. This is a preview — nothing was written.'
    : '3. Show the dream log path (outputs/dream/dream-YYYY-MM-DD.md).'
}

This mirrors the AutoDream nightly daemon (tools/dream.sh) which runs at 2am automatically.`,
          },
        },
      ],
    }),
  );
}
