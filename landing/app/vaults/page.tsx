import Link from 'next/link';
import { createWorkspaceClient } from '@/lib/workspace';
import { countMarkdown } from '@/lib/vault-fs';
import { VaultSidebar } from '@/components/VaultSidebar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function VaultsIndexPage() {
  const client = createWorkspaceClient();
  const vaults = await client.list();
  const enriched = vaults.map((v) => ({ ...v, counts: countMarkdown(v.path) }));

  return (
    <div className="flex min-h-screen">
      <VaultSidebar />
      <main className="flex-1 px-8 py-10">
        <header className="mb-8">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[color:var(--muted)]">
            Workspace
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Your vaults</h1>
          <p className="mt-2 max-w-2xl text-sm text-[color:var(--muted)]">
            Registered in <code className="font-mono">~/.obs/workspace.yaml</code>. Click one to
            browse its raw, compiled, and outputs folders or ask a question.
          </p>
        </header>

        {enriched.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {enriched.map((v) => (
              <li
                key={v.name}
                className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-5"
              >
                <Link href={`/vaults/${encodeURIComponent(v.name)}`} className="block">
                  <div className="flex items-center justify-between">
                    <h2 className="font-mono text-sm text-[color:var(--foreground)]">{v.name}</h2>
                    <span className="text-[10px] uppercase tracking-widest text-[color:var(--muted)]">
                      {v.kind}
                    </span>
                  </div>
                  {v.description && (
                    <p className="mt-2 text-xs text-[color:var(--muted)]">{v.description}</p>
                  )}
                  <p className="mt-3 truncate font-mono text-[11px] text-[color:var(--muted)]">
                    {v.path}
                  </p>
                  <div className="mt-4 flex gap-4 font-mono text-[11px] text-[color:var(--muted)]">
                    <span>raw: {v.counts.raw}</span>
                    <span>compiled: {v.counts.compiled}</span>
                    <span>outputs: {v.counts.outputs}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-[color:var(--border)] bg-[color:var(--card)] p-10 text-center">
      <h2 className="text-lg font-semibold">No vaults yet</h2>
      <p className="mt-2 text-sm text-[color:var(--muted)]">
        Register one with the CLI:
      </p>
      <pre className="mx-auto mt-4 inline-block rounded-md border border-[color:var(--border)] bg-black/30 px-4 py-2 text-left font-mono text-xs">
        obs init
        {'\n'}
        obs kb init
      </pre>
      <p className="mt-4 text-xs text-[color:var(--muted)]">
        Or in dev: <code className="font-mono">OBS_DEV_VAULTS=/path/to/vault pnpm dev</code>
      </p>
    </div>
  );
}
