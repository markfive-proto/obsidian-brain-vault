import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateObject, generateText, type LanguageModel } from 'ai';
import type { z } from 'zod';

export type LLMProvider = 'anthropic' | 'openai' | 'google';

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  apiKey?: string;
}

const DEFAULTS: Record<LLMProvider, { model: string; envKey: string }> = {
  anthropic: { model: 'claude-sonnet-4-6', envKey: 'ANTHROPIC_API_KEY' },
  openai: { model: 'gpt-5.4', envKey: 'OPENAI_API_KEY' },
  google: { model: 'gemini-2.5-pro', envKey: 'GEMINI_API_KEY' },
};

/**
 * Resolve an LLM config from environment variables and optional overrides.
 *
 * Precedence:
 *   1. Explicit override via the function argument
 *   2. OBS_LLM_PROVIDER / OBS_LLM_MODEL env vars
 *   3. Built-in defaults (Claude Sonnet 4.6)
 *
 * Throws a helpful error if the matching API key isn't set.
 */
export function resolveLLMConfig(override?: Partial<LLMConfig>): LLMConfig {
  const provider = (override?.provider ?? (process.env.OBS_LLM_PROVIDER as LLMProvider) ?? 'anthropic') as LLMProvider;
  if (!(provider in DEFAULTS)) {
    throw new Error(`Unknown LLM provider: ${provider}. Use one of: anthropic, openai, google.`);
  }
  const defaults = DEFAULTS[provider];
  const model = override?.model ?? process.env.OBS_LLM_MODEL ?? defaults.model;
  const apiKey = override?.apiKey ?? process.env[defaults.envKey];
  if (!apiKey) {
    throw new Error(
      `${defaults.envKey} is not set. Add it to your shell env (or pass --api-key):\n` +
        `  export ${defaults.envKey}=<your key>\n` +
        `Or choose a different provider:\n` +
        `  export OBS_LLM_PROVIDER=anthropic | openai | google`,
    );
  }
  return { provider, model, apiKey };
}

/**
 * Produce a provider-specific model instance compatible with Vercel AI SDK's
 * generateText / generateObject / streamText entry points.
 */
export function llmModel(config: LLMConfig): LanguageModel {
  switch (config.provider) {
    case 'anthropic':
      return createAnthropic({ apiKey: config.apiKey })(config.model);
    case 'openai':
      return createOpenAI({ apiKey: config.apiKey })(config.model);
    case 'google':
      return createGoogleGenerativeAI({ apiKey: config.apiKey })(config.model);
  }
}

/**
 * Thin wrapper that returns completion text. Used by narrative tasks
 * (summaries, answers, rewrites) where structured output would be overkill.
 */
export async function llmText(
  prompt: string,
  opts: { config?: LLMConfig; system?: string; maxTokens?: number } = {},
): Promise<string> {
  const config = opts.config ?? resolveLLMConfig();
  const { text } = await generateText({
    model: llmModel(config),
    system: opts.system,
    prompt,
    maxOutputTokens: opts.maxTokens,
  });
  return text;
}

/**
 * Thin wrapper that returns a typed object validated against a Zod schema.
 * This is how compile extracts concepts from a raw source, how ask extracts
 * entities from a question, etc.
 */
export async function llmObject<T>(
  prompt: string,
  schema: z.ZodSchema<T>,
  opts: { config?: LLMConfig; system?: string; maxTokens?: number } = {},
): Promise<T> {
  const config = opts.config ?? resolveLLMConfig();
  const { object } = await generateObject({
    model: llmModel(config),
    schema,
    system: opts.system,
    prompt,
    maxOutputTokens: opts.maxTokens,
  });
  return object;
}
