import { notFound } from 'next/navigation';
import { createWorkspaceClient } from '@/lib/workspace';
import { countMarkdown, isVaultDir, vaultLastModified, type VaultDir } from '@/lib/vault-fs';
import { VaultSidebar } from '@/components/VaultSidebar';
import { TabBar } from '@/components/TabBar';
import { VaultBrowser } from './VaultBrowser';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Props {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ dir?: string }>;
}

export default async function VaultPage({ params, searchParams }: Props) {
  const { name } = await params;
  const { dir: dirParam } = await searchParams;
  const client = createWorkspaceClient();
  const vault = await client.get(name);
  if (!vault) notFound();

  const dir: VaultDir = isVaultDir(dirParam ?? '') ? (dirParam as VaultDir) : 'compiled';
  const counts = countMarkdown(vault.path);
  const lastModified = vaultLastModified(vault.path);

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
          {vault.description && (
            <p className="mt-1 text-sm text-[color:var(--muted)]">{vault.description}</p>
          )}
          <p className="mt-1 truncate font-mono text-[11px] text-[color:var(--muted)]">
            {vault.path}
            {lastModified > 0 && (
              <span className="ml-3">
                last modified {new Date(lastModified).toLocaleString()}
              </span>
            )}
          </p>
        </header>
        <TabBar tabs={tabs} activeKey={dir} />
        <div className="flex-1 overflow-hidden">
          <VaultBrowser vaultName={name} dir={dir} />
        </div>
      </main>
    </div>
  );
}
