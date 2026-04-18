'use client';

import { useEffect, useState } from 'react';
import { FileTree } from '@/components/FileTree';
import { MarkdownView } from '@/components/MarkdownView';

interface Props {
  vaultName: string;
  dir: 'raw' | 'compiled' | 'outputs';
}

export function VaultBrowser({ vaultName, dir }: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  // Reset selection when switching folders.
  useEffect(() => {
    setSelected(null);
  }, [vaultName, dir]);

  return (
    <div className="grid h-full grid-cols-[280px_1fr]">
      <div className="overflow-y-auto border-r border-[color:var(--border)]">
        <FileTree
          vaultName={vaultName}
          dir={dir}
          selected={selected}
          onSelect={setSelected}
        />
      </div>
      <div className="overflow-hidden">
        <MarkdownView vaultName={vaultName} filePath={selected} />
      </div>
    </div>
  );
}
