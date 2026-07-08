import type { ZodRawShape, z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import { Vault } from '../vault.js';

/**
 * Lightweight tool registry for new MCP tools.
 *
 * - `scope` gates registration: with OBS_MCP_READONLY=1 only `read` tools
 *   are registered ('write' mutates the vault, 'llm' additionally spends
 *   API tokens).
 * - Handlers return plain values; the registry stringifies them and turns
 *   thrown errors into a uniform `isError` envelope.
 * - `ctx.progress` forwards to MCP progress notifications when the client
 *   sent a progressToken — long LLM calls should call it regularly to keep
 *   proxies from idling out the connection.
 */

export type ToolScope = 'read' | 'write' | 'llm';

export interface ToolContext {
  vault: Vault;
  progress: (message: string) => Promise<void>;
  signal: AbortSignal;
}

export interface ToolDef<Shape extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  scope: ToolScope;
  schema: Shape;
  handler: (args: z.output<z.ZodObject<Shape>>, ctx: ToolContext) => Promise<unknown>;
}

export function defineTool<Shape extends ZodRawShape>(def: ToolDef<Shape>): ToolDef<Shape> {
  return def;
}

export interface RegisterOptions {
  readonly?: boolean;
}

export function isReadonlyEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.OBS_MCP_READONLY;
  return v === '1' || v === 'true';
}

export function registerAll(
  server: McpServer,
  vault: Vault,
  tools: Array<ToolDef<ZodRawShape>>,
  opts: RegisterOptions = {},
): string[] {
  const registered: string[] = [];
  for (const tool of tools) {
    if (opts.readonly && tool.scope !== 'read') continue;
    server.tool(
      tool.name,
      tool.description,
      tool.schema,
      async (args: Record<string, unknown>, extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
        const progressToken = extra._meta?.progressToken;
        let step = 0;
        const progress = async (message: string): Promise<void> => {
          if (progressToken === undefined) return;
          step += 1;
          try {
            await extra.sendNotification({
              method: 'notifications/progress',
              params: { progressToken, progress: step, message },
            });
          } catch { /* notification failures must not kill the tool call */ }
        };
        try {
          const result = await tool.handler(args as never, { vault, progress, signal: extra.signal });
          const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
          return { content: [{ type: 'text' as const, text }] };
        } catch (err) {
          return {
            content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
            isError: true,
          };
        }
      },
    );
    registered.push(tool.name);
  }
  return registered;
}
