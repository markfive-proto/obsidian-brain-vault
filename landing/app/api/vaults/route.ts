import { NextResponse } from 'next/server';
import { createWorkspaceClient } from '@/lib/workspace';
import { countMarkdown } from '@/lib/vault-fs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const client = createWorkspaceClient();
  const vaults = await client.list();
  const enriched = vaults.map((v) => ({
    name: v.name,
    path: v.path,
    kind: v.kind,
    description: v.description,
    default: v.isDefault,
    counts: countMarkdown(v.path),
  }));
  return NextResponse.json(enriched);
}
