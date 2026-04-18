import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { NextResponse } from 'next/server';
import { createWorkspaceClient } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AskModule {
  askKb: (
    vaultPath: string,
    question: string,
    opts?: { includeRaw?: boolean },
  ) => Promise<unknown>;
}

/**
 * POST /api/vaults/:name/ask
 *   body: { question: string, includeRaw?: boolean }
 *   -> full AskResult JSON
 *
 * Strategy: dynamically import `askKb` from the repo's `src/kb/ask.ts` at
 * request time (not at module load). This keeps `pnpm build` green even
 * if the source tree is mid-refactor, and defers any LLM-config evaluation
 * to when the route is actually invoked. If the dynamic import fails
 * (module surgery not possible in the current build topology), we surface
 * a clear 500 with a hint for the integrator rather than crashing at
 * build time.
 *
 * At integration time the lead can:
 *   1. Replace the dynamic import with a static `import { askKb } from ...`,
 *      once the parent `src/` tree is stable and TS paths are configured; or
 *   2. Fall back to spawning the CLI: `spawn('obs', ['--vault', p, 'kb',
 *      'ask', q, '--json'])`.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  let body: { question?: unknown; includeRaw?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  const includeRaw = body.includeRaw === true;
  if (!question) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 });
  }

  const client = createWorkspaceClient();
  const vault = await client.get(name);
  if (!vault) {
    return NextResponse.json({ error: 'Vault not found' }, { status: 404 });
  }

  try {
    // Resolve against an absolute file URL so webpack/turbopack don't try
    // to bundle this as a static dependency. Hit the compiled `dist/`
    // output, which is what the CLI ships.
    const target = pathToFileURL(
      path.join(process.cwd(), '..', 'dist', 'kb', 'ask.js'),
    ).href;
    const mod = (await import(/* webpackIgnore: true */ target)) as AskModule;
    const result = await mod.askKb(vault.path, question, { includeRaw });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      {
        error: 'askKb invocation failed',
        detail: message,
        hint: 'At integration time, either swap the dynamic import in app/api/vaults/[name]/ask/route.ts for a static import, or fall back to spawn("obs", ["--vault", path, "kb", "ask", question, "--json"]).',
      },
      { status: 500 },
    );
  }
}
