import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../../src/vault.js';
import { buildIndex } from '../../src/kb/index-store.js';
import type { EmbedFn } from '../../src/kb/embeddings.js';

// Stub the LLM: capture prompts, return canned answers.
const llmCalls: string[] = [];
let cannedAnswers: unknown[] = [];

vi.mock('../../src/kb/llm.js', () => ({
  resolveLLMConfig: () => ({ provider: 'openai', model: 'fake', apiKey: 'fake' }),
  llmObject: async (prompt: string) => {
    llmCalls.push(prompt);
    return cannedAnswers.length > 1 ? cannedAnswers.shift() : cannedAnswers[0];
  },
}));

const { askKb } = await import('../../src/kb/ask.js');

const KEYWORDS = ['pricing', 'coffee'];
const fakeEmbed: EmbedFn = async (texts) =>
  texts.map(t => KEYWORDS.map(k => (t.toLowerCase().includes(k) ? 1 : 0.01)));

const answer = (gaps: string[] = []) => ({
  restatedQuestion: 'Agent pricing',
  tldrBullets: ['Charge per outcome.'],
  detailedAnswer: 'Charge per outcome [[agent-pricing]].',
  evidence: [{ claim: 'Charge per outcome', sources: ['agent-pricing'] }],
  gaps,
  confidence: 'high',
  confidenceReason: 'Directly stated.',
  relatedNotes: [],
});

describe('askKb retrieval mode', () => {
  let tempDir: string;
  let vault: Vault;

  beforeEach(async () => {
    llmCalls.length = 0;
    cannedAnswers = [answer()];
    tempDir = mkdtempSync(join(tmpdir(), 'ask-retrieval-'));
    mkdirSync(join(tempDir, '.obsidian'), { recursive: true });
    mkdirSync(join(tempDir, 'compiled', 'concepts'), { recursive: true });
    writeFileSync(join(tempDir, 'compiled', 'concepts', 'agent-pricing.md'),
      '---\ntitle: Agent pricing\ntype: concept\n---\n# Agent pricing\nCharge per outcome, pricing matters.\n');
    writeFileSync(join(tempDir, 'compiled', 'concepts', 'coffee-brewing.md'),
      '---\ntitle: Coffee brewing\ntype: concept\n---\n# Coffee brewing\nCoffee coffee coffee V60.\n');
    vault = new Vault(tempDir);
    await buildIndex(vault, { meta: { provider: 'fake', model: 'f', dimensions: 2 }, embedFn: fakeEmbed });
  });

  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  it('uses retrieval when the index exists and only sends relevant notes', async () => {
    const result = await askKb(tempDir, 'how should we do pricing?', {
      addBacklinks: false,
      embedFn: fakeEmbed,
      retrievalK: 1,
    });
    expect(result.contextMode).toBe('retrieval');
    expect(result.rounds).toBe(1);
    expect(llmCalls).toHaveLength(1);
    expect(llmCalls[0]).toContain('agent-pricing');
    expect(llmCalls[0]).not.toContain('coffee-brewing');
    expect(result.answerPath).toMatch(/^outputs\/answers\//);
  });

  it('falls back to corpus mode when no index exists', async () => {
    rmSync(join(tempDir, '.obs-index'), { recursive: true, force: true });
    const result = await askKb(tempDir, 'how should we do pricing?', { addBacklinks: false });
    expect(result.contextMode).toBe('corpus');
    // corpus mode loads everything
    expect(llmCalls[0]).toContain('coffee-brewing');
  });

  it('deep mode runs a second round seeded by gaps', async () => {
    cannedAnswers = [answer(['coffee brewing methods']), answer()];
    const result = await askKb(tempDir, 'how should we do pricing?', {
      addBacklinks: false,
      embedFn: fakeEmbed,
      retrievalK: 1,
      deep: true,
    });
    expect(result.rounds).toBe(2);
    expect(llmCalls).toHaveLength(2);
    // the widened round-2 context pulls in the note matching the gap
    expect(llmCalls[1]).toContain('coffee-brewing');
  });
});
