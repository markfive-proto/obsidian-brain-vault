import { notFound } from 'next/navigation';
import { createWorkspaceClient } from '@/lib/workspace';
import { countMarkdown } from '@/lib/vault-fs';
import { VaultSidebar } from '@/components/VaultSidebar';
import { TabBar } from '@/components/TabBar';
import { AskPanel } from '@/components/AskPanel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Props {
  params: Promise<{ name: string }>;
}

export default async function AskVaultPage({ params }: Props) {
  const { name } = await params;
  const client = createWorkspaceClient();
  const vault = await client.get(name);
  if (!vault) notFound();

  const counts = countMarkdown(vault.path);
  const encoded = encodeURIComponent(name);
  const tabs = [
    { key: 'raw', label: `raw (${counts.raw})`, href: `/vaults/${encoded}?dir=raw` },
    { key: 'compiled', label: `compiled (${counts.compiled})`, href: `/vaults/${encoded}?dir=compiled` },
    { key: 'outputs', label: `outputs (${counts.outputs})`, href: `/vaults/${encoded}?dir=outputs` },
    { key: 'ask', label: 'ask', href: `/vaults/${encoded}/ask` },
  ];

  return (
    <div className="flex min-h-screen">
      <VaultSidebar activeName={name} />
      <main className="flex flex-1 flex-col">
        <header className="border-b border-[color:var(--border)] px-6 py-5">
          <p className="font-mono text-[11px] uppercase tracking-widest text-[color:var(--muted)]">
            Vault · {vault.kind}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{vault.name}</h1>
        </header>
        <TabBar tabs={tabs} activeKey="ask" />
        <div className="flex-1 overflow-hidden">
          <AskPanel vaultName={name} />
        </div>
      </main>
    </div>
  );
}
