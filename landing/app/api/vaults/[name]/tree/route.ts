import { NextResponse } from 'next/server';
import { createWorkspaceClient } from '@/lib/workspace';
import { isVaultDir, listTree } from '@/lib/vault-fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const dir = new URL(req.url).searchParams.get('dir') ?? 'compiled';
  if (!isVaultDir(dir)) {
    return NextResponse.json(
      { error: "dir must be 'raw', 'compiled', or 'outputs'" },
      { status: 400 },
    );
  }
  const client = createWorkspaceClient();
  const vault = await client.get(name);
  if (!vault) {
    return NextResponse.json({ error: 'Vault not found' }, { status: 404 });
  }
  return NextResponse.json(listTree(vault.path, dir));
}
