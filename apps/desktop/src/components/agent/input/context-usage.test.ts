import { describe, expect, it } from 'bun:test';
import {
  computeContextUsage,
  estimateTextTokens,
  resolveModelContext,
} from './context-usage';

import type { ModelInfo } from '../../../lib/backend';
import type { Message } from '../../../stores/agentStore';

const models: ModelInfo[] = [
  {
    id: 'claude-opus-4-7[1m]',
    display_name: 'Claude Opus 4.7 (1M)',
    alias: 'opus',
    provider: 'anthropic',
    is_default: true,
    description: '',
    context_window: 1_000_000,
    max_output_tokens: 64_000,
  },
  {
    id: 'gpt-5.4',
    display_name: 'GPT-5.4',
    alias: 'gpt54',
    provider: 'openai',
    is_default: false,
    description: '',
    context_window: 1_000_000,
    max_output_tokens: 32_768,
  },
  {
    id: 'gemini-3.1-pro-preview',
    display_name: 'Gemini 3.1 Pro',
    alias: 'gemini-pro',
    provider: 'gemini',
    is_default: false,
    description: '',
    context_window: 1_000_000,
    max_output_tokens: 65_536,
  },
];

function assistantWithUsage(modelUsage: Message['usage']): Message {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    blocks: [],
    timestamp: new Date(0),
    usage: modelUsage,
  };
}

describe('context usage', () => {
  it('resolves context windows from backend model ids and aliases', () => {
    expect(resolveModelContext('gpt54', models).contextWindow).toBe(1_000_000);
    expect(resolveModelContext('gemini-3-pro', []).contextWindow).toBe(1_000_000);
    expect(resolveModelContext('unknown-model', []).contextWindow).toBe(200_000);
  });

  it('does not invent hidden system/tool tokens before provider usage exists', () => {
    const usage = computeContextUsage([], 'claude-opus-4-7[1m]', models);

    expect(usage.source).toBe('estimate');
    expect(usage.total).toBe(0);
    expect(usage.max).toBe(1_000_000);
  });

  it('adds Anthropic cache usage because Anthropic input_tokens excludes cache reads and writes', () => {
    const usage = computeContextUsage(
      [
        assistantWithUsage({
          inputTokens: 1_000,
          outputTokens: 250,
          cacheCreationInputTokens: 50,
          cacheReadInputTokens: 200,
        }),
      ],
      'claude-opus-4-7[1m]',
      models,
    );

    expect(usage.source).toBe('real');
    expect(usage.total).toBe(1_250);
  });

  it('does not double count OpenAI cached tokens because they are a breakdown of input tokens', () => {
    const usage = computeContextUsage(
      [
        assistantWithUsage({
          inputTokens: 1_000,
          outputTokens: 250,
          cacheReadInputTokens: 200,
        }),
      ],
      'gpt-5.4',
      models,
    );

    expect(usage.source).toBe('real');
    expect(usage.total).toBe(1_000);
    expect(usage.breakdown).toContainEqual({ label: 'Input', tokens: 800 });
    expect(usage.breakdown).toContainEqual({ label: 'Cache read', tokens: 200 });
  });

  it('does not double count Gemini cached tokens because promptTokenCount includes cached content', () => {
    const usage = computeContextUsage(
      [
        assistantWithUsage({
          inputTokens: 1_000,
          outputTokens: 250,
          cacheReadInputTokens: 300,
        }),
      ],
      'gemini-3.1-pro-preview',
      models,
    );

    expect(usage.source).toBe('real');
    expect(usage.total).toBe(1_000);
    expect(usage.breakdown).toContainEqual({ label: 'Input', tokens: 700 });
    expect(usage.breakdown).toContainEqual({ label: 'Cache read', tokens: 300 });
  });

  it('adds the current composer draft as an estimate on top of the latest real usage', () => {
    const draft = 'Please inspect the auth flow.';
    const usage = computeContextUsage(
      [
        assistantWithUsage({
          inputTokens: 1_000,
          outputTokens: 250,
        }),
      ],
      'gpt-5.4',
      models,
      draft,
    );

    expect(usage.source).toBe('mixed');
    expect(usage.total).toBe(1_000 + estimateTextTokens(draft));
    expect(usage.breakdown).toContainEqual({
      label: 'Current draft',
      tokens: estimateTextTokens(draft),
    });
  });
});
