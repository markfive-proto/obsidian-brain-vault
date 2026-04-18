'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface VaultListItem {
  name: string;
  path: string;
  kind: string;
  description?: string;
  default?: boolean;
  counts: { raw: number; compiled: number; outputs: number };
}

interface Props {
  activeName?: string;
}

export function VaultSidebar({ activeName }: Props) {
  const [vaults, setVaults] = useState<VaultListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/vaults')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as VaultListItem[];
      })
      .then((data) => {
        if (!cancelled) setVaults(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load vaults');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-[color:var(--border)] bg-[color:var(--card)]">
      <div className="border-b border-[color:var(--border)] px-4 py-4">
        <Link href="/" className="block text-sm font-semibold tracking-tight">
          Brain Vault
        </Link>
        <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-[color:var(--muted)]">
          obs · web
        </p>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-[color:var(--muted)]">
          Vaults
        </div>
        {error && (
          <p className="px-2 py-2 text-xs text-red-400">Error: {error}</p>
        )}
        {!vaults && !error && (
          <p className="px-2 py-2 text-xs text-[color:var(--muted)]">Loading…</p>
        )}
        {vaults && vaults.length === 0 && (
          <p className="px-2 py-2 text-xs text-[color:var(--muted)]">
            No vaults yet. Run <code className="font-mono">obs init</code> to register one.
          </p>
        )}
        {vaults?.map((v) => {
          const active = v.name === activeName;
          return (
            <Link
              key={v.name}
              href={`/vaults/${encodeURIComponent(v.name)}`}
              className={`flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition ${
                active
                  ? 'bg-black/40 text-[color:var(--foreground)]'
                  : 'text-[color:var(--muted)] hover:bg-black/20 hover:text-[color:var(--foreground)]'
              }`}
            >
              <span className="flex items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    active ? 'bg-[color:var(--accent)]' : 'bg-[color:var(--border)]'
                  }`}
                />
                <span className="font-mono text-xs">{v.name}</span>
              </span>
              {v.default && (
                <span className="text-[9px] uppercase tracking-widest text-[color:var(--accent)]">
                  def
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-[color:var(--border)] px-4 py-3 text-[10px] text-[color:var(--muted)]">
        <kbd className="rounded border border-[color:var(--border)] px-1 py-0.5 font-mono">
          ⌘K
        </kbd>{' '}
        switch vault
      </div>

      {paletteOpen && vaults && (
        <CommandPalette
          vaults={vaults}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </aside>
  );
}

function CommandPalette({
  vaults,
  onClose,
}: {
  vaults: VaultListItem[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = vaults.filter((v) =>
    v.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[20vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Switch vault…"
          className="w-full rounded-t-xl border-b border-[color:var(--border)] bg-transparent px-4 py-3 text-sm outline-none"
        />
        <ul className="max-h-72 overflow-y-auto py-2">
          {filtered.length === 0 && (
            <li className="px-4 py-2 text-xs text-[color:var(--muted)]">No matches</li>
          )}
          {filtered.map((v) => (
            <li key={v.name}>
              <Link
                href={`/vaults/${encodeURIComponent(v.name)}`}
                className="flex items-center justify-between px-4 py-2 text-sm hover:bg-black/30"
                onClick={onClose}
              >
                <span className="font-mono text-xs">{v.name}</span>
                <span className="text-[10px] text-[color:var(--muted)]">{v.kind}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
