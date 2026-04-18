import { NextResponse } from 'next/server';
import { createWorkspaceClient } from '@/lib/workspace';
import { readMarkdown, VaultFsError } from '@/lib/vault-fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const filePath = new URL(req.url).searchParams.get('path');
  if (!filePath) {
    return NextResponse.json({ error: 'path query param required' }, { status: 400 });
  }
  const client = createWorkspaceClient();
  const vault = await client.get(name);
  if (!vault) {
    return NextResponse.json({ error: 'Vault not found' }, { status: 404 });
  }
  try {
    const parsed = readMarkdown(vault.path, filePath);
    return NextResponse.json(parsed);
  } catch (err) {
    if (err instanceof VaultFsError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
