import { NextResponse } from 'next/server';
import { createWorkspaceClient } from '@/lib/workspace';
import { countMarkdown, vaultLastModified } from '@/lib/vault-fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const client = createWorkspaceClient();
  const vault = await client.get(name);
  if (!vault) {
    return NextResponse.json({ error: 'Vault not found' }, { status: 404 });
  }
  return NextResponse.json({
    name: vault.name,
    path: vault.path,
    kind: vault.kind,
    description: vault.description,
    default: vault.isDefault,
    counts: countMarkdown(vault.path),
    lastModified: vaultLastModified(vault.path),
  });
}
