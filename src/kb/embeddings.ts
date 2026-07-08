import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { embedMany } from 'ai';

/**
 * Embedding provider resolution, mirroring resolveLLMConfig in llm.ts.
 * Anthropic offers no embeddings API, so the default here is OpenAI even
 * though the LLM default is Anthropic.
 */

export type EmbedProvider = 'openai' | 'google';

export interface EmbedConfig {
  provider: EmbedProvider;
  model: string;
  apiKey?: string;
  dimensions: number;
}

/** Batch text → vectors. Injectable so tests never hit the network. */
export type EmbedFn = (texts: string[]) => Promise<number[][]>;

const DEFAULTS: Record<EmbedProvider, { model: string; envKey: string; dimensions: number }> = {
  openai: { model: 'text-embedding-3-small', envKey: 'OPENAI_API_KEY', dimensions: 512 },
  google: { model: 'gemini-embedding-001', envKey: 'GEMINI_API_KEY', dimensions: 768 },
};

export function resolveEmbedConfig(override?: Partial<EmbedConfig>): EmbedConfig {
  const provider = (override?.provider ?? (process.env.OBS_EMBED_PROVIDER as EmbedProvider) ?? 'openai') as EmbedProvider;
  if (!(provider in DEFAULTS)) {
    throw new Error(`Unknown embedding provider: ${provider}. Use one of: openai, google.`);
  }
  const defaults = DEFAULTS[provider];
  const model = override?.model ?? process.env.OBS_EMBED_MODEL ?? defaults.model;
  const dimensions = override?.dimensions
    ?? (process.env.OBS_EMBED_DIMENSIONS ? parseInt(process.env.OBS_EMBED_DIMENSIONS, 10) : defaults.dimensions);
  const apiKey = override?.apiKey ?? process.env[defaults.envKey];
  if (!apiKey) {
    throw new Error(
      `${defaults.envKey} is not set — semantic search needs an embeddings API key.\n` +
        `  export ${defaults.envKey}=<your key>\n` +
        `Or choose a different provider:\n` +
        `  export OBS_EMBED_PROVIDER=openai | google`,
    );
  }
  return { provider, model, apiKey, dimensions };
}

const BATCH_SIZE = 96;

export function makeEmbedFn(config: EmbedConfig): EmbedFn {
  const model = config.provider === 'openai'
    ? createOpenAI({ apiKey: config.apiKey }).textEmbedding(config.model)
    : createGoogleGenerativeAI({ apiKey: config.apiKey }).textEmbedding(config.model);

  const providerOptions: Record<string, Record<string, number>> = config.provider === 'openai'
    ? { openai: { dimensions: config.dimensions } }
    : { google: { outputDimensionality: config.dimensions } };

  return async (texts: string[]): Promise<number[][]> => {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const { embeddings } = await embedMany({
        model,
        values: texts.slice(i, i + BATCH_SIZE),
        providerOptions,
      });
      out.push(...embeddings);
    }
    return out;
  };
}
