'use client';

import Link from 'next/link';

export interface Tab {
  key: string;
  label: string;
  href: string;
}

interface Props {
  tabs: Tab[];
  activeKey: string;
}

export function TabBar({ tabs, activeKey }: Props) {
  return (
    <nav className="flex gap-1 border-b border-[color:var(--border)] px-6">
      {tabs.map((t) => {
        const active = t.key === activeKey;
        return (
          <Link
            key={t.key}
            href={t.href}
            className={`-mb-px border-b-2 px-3 py-2 font-mono text-xs uppercase tracking-widest transition ${
              active
                ? 'border-[color:var(--accent)] text-[color:var(--foreground)]'
                : 'border-transparent text-[color:var(--muted)] hover:text-[color:var(--foreground)]'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
