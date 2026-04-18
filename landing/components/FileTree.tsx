'use client';

import { useEffect, useState } from 'react';

interface TreeEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size: number;
  mtime: number;
}

interface Props {
  vaultName: string;
  dir: 'raw' | 'compiled' | 'outputs';
  selected: string | null;
  onSelect: (path: string) => void;
}

export function FileTree({ vaultName, dir, selected, onSelect }: Props) {
  const [entries, setEntries] = useState<TreeEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);
    fetch(`/api/vaults/${encodeURIComponent(vaultName)}/tree?dir=${dir}`)
      .then(async (r) => {
        const json = (await r.json()) as TreeEntry[] | { error: string };
        if (!r.ok) throw new Error('error' in json ? json.error : `HTTP ${r.status}`);
        return json as TreeEntry[];
      })
      .then((data) => {
        if (!cancelled) setEntries(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      });
    return () => {
      cancelled = true;
    };
  }, [vaultName, dir]);

  if (error) {
    return <div className="p-3 text-xs text-red-400">Error: {error}</div>;
  }
  if (!entries) {
    return <div className="p-3 text-xs text-[color:var(--muted)]">Loading…</div>;
  }
  const files = entries.filter((e) => e.type === 'file' && e.name.endsWith('.md'));
  if (files.length === 0) {
    return (
      <div className="p-3 text-xs text-[color:var(--muted)]">
        No markdown files in <code className="font-mono">{dir}/</code>.
      </div>
    );
  }
  return (
    <ul className="space-y-0.5 p-2">
      {files.map((f) => {
        const active = f.path === selected;
        return (
          <li key={f.path}>
            <button
              type="button"
              onClick={() => onSelect(f.path)}
              className={`block w-full truncate rounded px-2 py-1 text-left font-mono text-xs transition ${
                active
                  ? 'bg-black/40 text-[color:var(--foreground)]'
                  : 'text-[color:var(--muted)] hover:bg-black/20 hover:text-[color:var(--foreground)]'
              }`}
              title={f.path}
            >
              {f.path.replace(new RegExp(`^${dir}/`), '')}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
