import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { Vault } from '../../src/vault.js';
import { defineTool, registerAll, isReadonlyEnv, type ToolDef } from '../../src/mcp/registry.js';
import type { ZodRawShape } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

type RegisteredHandler = (args: Record<string, unknown>, extra: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

function fakeServer() {
  const handlers = new Map<string, RegisteredHandler>();
  const server = {
    tool: (name: string, _desc: string, _schema: unknown, cb: RegisteredHandler) => {
      handlers.set(name, cb);
    },
  } as unknown as McpServer;
  return { server, handlers };
}

const fakeExtra = (notifications: unknown[] = [], progressToken?: string | number) => ({
  signal: new AbortController().signal,
  _meta: progressToken === undefined ? undefined : { progressToken },
  sendNotification: async (n: unknown) => { notifications.push(n); },
});

describe('MCP tool registry', () => {
  let tempDir: string;
  let vault: Vault;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'registry-test-'));
    mkdirSync(join(tempDir, '.obsidian'), { recursive: true });
    vault = new Vault(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const makeTools = (): Array<ToolDef<ZodRawShape>> => [
    defineTool({
      name: 't_read',
      description: 'read tool',
      scope: 'read',
      schema: { q: z.string() },
      handler: async ({ q }) => ({ echoed: q }),
    }),
    defineTool({
      name: 't_write',
      description: 'write tool',
      scope: 'write',
      schema: {},
      handler: async () => 'wrote',
    }),
    defineTool({
      name: 't_llm',
      description: 'llm tool',
      scope: 'llm',
      schema: {},
      handler: async () => { throw new Error('OPENAI_API_KEY missing'); },
    }),
  ] as unknown as Array<ToolDef<ZodRawShape>>;

  it('registers all tools by default', () => {
    const { server, handlers } = fakeServer();
    const names = registerAll(server, vault, makeTools());
    expect(names).toEqual(['t_read', 't_write', 't_llm']);
    expect([...handlers.keys()]).toEqual(['t_read', 't_write', 't_llm']);
  });

  it('registers only read tools in readonly mode', () => {
    const { server, handlers } = fakeServer();
    const names = registerAll(server, vault, makeTools(), { readonly: true });
    expect(names).toEqual(['t_read']);
    expect(handlers.has('t_write')).toBe(false);
    expect(handlers.has('t_llm')).toBe(false);
  });

  it('stringifies object results and passes strings through', async () => {
    const { server, handlers } = fakeServer();
    registerAll(server, vault, makeTools());

    const readResult = await handlers.get('t_read')!({ q: 'hi' }, fakeExtra());
    expect(JSON.parse(readResult.content[0].text)).toEqual({ echoed: 'hi' });
    expect(readResult.isError).toBeUndefined();

    const writeResult = await handlers.get('t_write')!({}, fakeExtra());
    expect(writeResult.content[0].text).toBe('wrote');
  });

  it('wraps thrown errors in an isError envelope', async () => {
    const { server, handlers } = fakeServer();
    registerAll(server, vault, makeTools());
    const result = await handlers.get('t_llm')!({}, fakeExtra());
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('OPENAI_API_KEY missing');
  });

  it('sends progress notifications only when a progressToken is present', async () => {
    const { server, handlers } = fakeServer();
    const tools = [
      defineTool({
        name: 't_progress',
        description: 'progress tool',
        scope: 'read',
        schema: {},
        handler: async (_args, ctx) => {
          await ctx.progress('step one');
          await ctx.progress('step two');
          return 'done';
        },
      }),
    ] as unknown as Array<ToolDef<ZodRawShape>>;
    registerAll(server, vault, tools);

    const withToken: unknown[] = [];
    await handlers.get('t_progress')!({}, fakeExtra(withToken, 'tok-1'));
    expect(withToken).toHaveLength(2);
    expect(withToken[0]).toMatchObject({
      method: 'notifications/progress',
      params: { progressToken: 'tok-1', progress: 1, message: 'step one' },
    });

    const withoutToken: unknown[] = [];
    await handlers.get('t_progress')!({}, fakeExtra(withoutToken));
    expect(withoutToken).toHaveLength(0);
  });

  it('isReadonlyEnv reads OBS_MCP_READONLY', () => {
    expect(isReadonlyEnv({})).toBe(false);
    expect(isReadonlyEnv({ OBS_MCP_READONLY: '0' })).toBe(false);
    expect(isReadonlyEnv({ OBS_MCP_READONLY: '1' })).toBe(true);
    expect(isReadonlyEnv({ OBS_MCP_READONLY: 'true' })).toBe(true);
  });
});
