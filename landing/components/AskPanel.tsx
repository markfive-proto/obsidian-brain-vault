'use client';

import { useState } from 'react';

interface AskResult {
  question: string;
  answer?: { body?: string; text?: string } | string | Record<string, unknown>;
  sourcesConsidered?: number;
  contextBytes?: number;
  answerPath?: string;
  answerAbsPath?: string;
  error?: string;
  detail?: string;
  hint?: string;
}

interface Entry {
  id: number;
  question: string;
  result?: AskResult;
  error?: string;
  loading: boolean;
}

function renderAnswerBody(result: AskResult): string {
  const a = result.answer;
  if (!a) return '';
  if (typeof a === 'string') return a;
  if (typeof a === 'object' && 'body' in a && typeof a.body === 'string') return a.body;
  if (typeof a === 'object' && 'text' in a && typeof a.text === 'string') return a.text;
  try {
    return JSON.stringify(a, null, 2);
  } catch {
    return String(a);
  }
}

interface Props {
  vaultName: string;
}

export function AskPanel({ vaultName }: Props) {
  const [question, setQuestion] = useState('');
  const [includeRaw, setIncludeRaw] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const q = question.trim();
    if (!q || submitting) return;
    const id = Date.now();
    const nextEntry: Entry = { id, question: q, loading: true };
    setEntries((prev) => [nextEntry, ...prev]);
    setQuestion('');
    setSubmitting(true);
    try {
      const resp = await fetch(`/api/vaults/${encodeURIComponent(vaultName)}/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q, includeRaw }),
      });
      const data = (await resp.json()) as AskResult;
      if (!resp.ok) {
        setEntries((prev) =>
          prev.map((e) =>
            e.id === id
              ? {
                  ...e,
                  loading: false,
                  error: data.error ?? `HTTP ${resp.status}`,
                  result: data,
                }
              : e,
          ),
        );
      } else {
        setEntries((prev) =>
          prev.map((e) => (e.id === id ? { ...e, loading: false, result: data } : e)),
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error';
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, loading: false, error: message } : e)),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {entries.length === 0 && (
          <div className="mx-auto max-w-xl pt-16 text-center">
            <h3 className="text-lg font-semibold">Ask your vault</h3>
            <p className="mt-2 text-sm text-[color:var(--muted)]">
              Your question is answered from the compiled/ wiki, with optional raw/ sources.
              Each answer becomes a new note under outputs/.
            </p>
          </div>
        )}
        <ul className="mx-auto flex max-w-3xl flex-col gap-6">
          {entries.map((e) => (
            <li
              key={e.id}
              className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-5"
            >
              <p className="mb-3 text-sm font-semibold">{e.question}</p>
              {e.loading && (
                <p className="font-mono text-xs text-[color:var(--muted)]">
                  Thinking…
                </p>
              )}
              {e.error && (
                <div className="font-mono text-xs text-red-400">
                  <p>Error: {e.error}</p>
                  {e.result?.detail && <p className="mt-1">{e.result.detail}</p>}
                  {e.result?.hint && (
                    <p className="mt-2 text-[color:var(--muted)]">{e.result.hint}</p>
                  )}
                </div>
              )}
              {e.result && !e.error && (
                <div>
                  <pre className="whitespace-pre-wrap font-sans text-[14px] leading-6">
                    {renderAnswerBody(e.result)}
                  </pre>
                  <div className="mt-4 flex flex-wrap gap-4 font-mono text-[11px] text-[color:var(--muted)]">
                    {e.result.sourcesConsidered !== undefined && (
                      <span>sources: {e.result.sourcesConsidered}</span>
                    )}
                    {e.result.contextBytes !== undefined && (
                      <span>ctx: {Math.round(e.result.contextBytes / 1024)}KB</span>
                    )}
                    {e.result.answerPath && <span>saved: {e.result.answerPath}</span>}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          void submit();
        }}
        className="sticky bottom-0 border-t border-[color:var(--border)] bg-[color:var(--background)] px-6 py-4"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="Ask a question about this vault…"
            rows={2}
            className="w-full resize-none rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] px-3 py-2 font-sans text-sm outline-none focus:border-[color:var(--accent)]"
          />
          <div className="flex items-center justify-between text-xs">
            <label className="flex items-center gap-2 text-[color:var(--muted)]">
              <input
                type="checkbox"
                checked={includeRaw}
                onChange={(e) => setIncludeRaw(e.target.checked)}
                className="accent-[color:var(--accent)]"
              />
              include raw sources
            </label>
            <button
              type="submit"
              disabled={submitting || !question.trim()}
              className="rounded-md bg-[color:var(--accent)] px-4 py-1.5 text-sm font-semibold text-[color:var(--background)] transition disabled:opacity-40"
            >
              Ask (⌘↵)
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
