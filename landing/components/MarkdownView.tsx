'use client';

import { useEffect, useState } from 'react';

interface ParsedFile {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

interface Props {
  vaultName: string;
  filePath: string | null;
}

export function MarkdownView({ vaultName, filePath }: Props) {
  const [file, setFile] = useState<ParsedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!filePath) {
      setFile(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(
      `/api/vaults/${encodeURIComponent(vaultName)}/file?path=${encodeURIComponent(filePath)}`,
    )
      .then(async (r) => {
        const json = (await r.json()) as ParsedFile | { error: string };
        if (!r.ok) throw new Error('error' in json ? json.error : `HTTP ${r.status}`);
        return json as ParsedFile;
      })
      .then((data) => {
        if (!cancelled) setFile(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [vaultName, filePath]);

  if (!filePath) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-sm text-[color:var(--muted)]">
        Select a file to preview.
      </div>
    );
  }
  if (loading) {
    return <div className="p-6 text-sm text-[color:var(--muted)]">Loading…</div>;
  }
  if (error) {
    return <div className="p-6 text-sm text-red-400">Error: {error}</div>;
  }
  if (!file) return null;

  return (
    <article className="h-full overflow-y-auto px-8 py-6">
      <header className="mb-6 border-b border-[color:var(--border)] pb-4">
        <h2 className="font-mono text-sm text-[color:var(--muted)]">{file.path}</h2>
        {Object.keys(file.frontmatter).length > 0 && (
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            {Object.entries(file.frontmatter).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-mono text-[color:var(--muted)]">{k}</dt>
                <dd className="font-mono text-[color:var(--foreground)]">
                  {Array.isArray(v) ? v.join(', ') : String(v)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </header>
      <pre className="whitespace-pre-wrap font-sans text-[15px] leading-7 text-[color:var(--foreground)]">
        {file.body}
      </pre>
    </article>
  );
}
