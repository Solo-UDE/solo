import {
  CLAUDE_HAIKU_4_5,
  CLAUDE_OPUS_4_7,
  CLAUDE_SONNET_4_6,
  GEMINI_3_FLASH,
  GEMINI_3_PRO,
  GPT_5_3_CODEX_SPARK,
  GPT_5_4,
  GPT_5_4_MINI,
  GPT_5_5,
  normalizeModelId,
  providerForModel,
  type ModelProvider,
} from '../../../lib/constants';

import type { ModelInfo } from '../../../lib/backend';
import type { Message } from '../../../stores/agentStore';
import type { TokenUsage } from '../../../types/agent-protocol';

const DEFAULT_CONTEXT_WINDOW = 200_000;

const MODEL_CONTEXT_WINDOW_FALLBACKS: Record<string, number> = {
  [CLAUDE_OPUS_4_7]: 1_000_000,
  [CLAUDE_SONNET_4_6]: 200_000,
  [CLAUDE_HAIKU_4_5]: 200_000,
  [GPT_5_5]: 272_000,
  [GPT_5_4]: 1_000_000,
  [GPT_5_3_CODEX_SPARK]: 1_000_000,
  [GPT_5_4_MINI]: 400_000,
  [GEMINI_3_PRO]: 1_000_000,
  [GEMINI_3_FLASH]: 1_000_000,
};

export interface ContextBreakdown {
  label: string;
  tokens: number;
}

export interface ContextUsageSummary {
  breakdown: ContextBreakdown[];
  total: number;
  max: number;
  source: 'real' | 'estimate' | 'mixed';
}

interface ResolvedModel {
  contextWindow: number;
  provider: ModelProvider;
}

function modelMatches(model: ModelInfo, modelId: string): boolean {
  const normalized = normalizeModelId(modelId).toLowerCase();
  return (
    model.id.toLowerCase() === normalized ||
    model.alias.toLowerCase() === normalized
  );
}

export function resolveModelContext(modelId: string | null, models: ModelInfo[]): ResolvedModel {
  const normalizedModelId = modelId ? normalizeModelId(modelId) : null;
  const model = normalizedModelId
    ? models.find((entry) => modelMatches(entry, normalizedModelId))
    : undefined;

  if (model) {
    return {
      contextWindow: model.context_window,
      provider: model.provider.toLowerCase() as ModelProvider,
    };
  }

  const fallbackWindow = normalizedModelId
    ? MODEL_CONTEXT_WINDOW_FALLBACKS[normalizedModelId]
    : undefined;

  return {
    contextWindow: fallbackWindow ?? DEFAULT_CONTEXT_WINDOW,
    provider: normalizedModelId ? providerForModel(normalizedModelId) : 'anthropic',
  };
}

export function estimateTextTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  const cjkMatches = trimmed.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu);
  const cjkTokens = cjkMatches?.length ?? 0;
  const withoutCjk = trimmed.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ' ');
  const words = withoutCjk.match(/[A-Za-z0-9_]+(?:[.'-][A-Za-z0-9_]+)*/g)?.length ?? 0;
  const punctuation = withoutCjk.match(/[^\sA-Za-z0-9_]/g)?.length ?? 0;
  const characterEstimate = Math.ceil(trimmed.length / 4);
  const lexicalEstimate = Math.ceil(words * 1.25 + punctuation * 0.5 + cjkTokens);

  return Math.max(1, characterEstimate, lexicalEstimate);
}

function findLatestUsage(messages: Message[]): TokenUsage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.usage) return msg.usage;
  }
  return null;
}

function estimateTranscript(messages: Message[]): ContextBreakdown[] {
  let messageTokens = 0;
  let toolTokens = 0;

  for (const msg of messages) {
    if (msg.content) messageTokens += estimateTextTokens(msg.content);
    for (const toolCall of msg.toolCalls ?? []) {
      const inputText =
        typeof toolCall.input === 'string'
          ? toolCall.input
          : JSON.stringify(toolCall.input ?? '');
      toolTokens += estimateTextTokens(inputText);
      toolTokens += estimateTextTokens(toolCall.output ?? '');
    }
  }

  return [
    { label: 'Session messages', tokens: messageTokens },
    { label: 'Tool transcript', tokens: toolTokens },
  ];
}

function usageBreakdown(usage: TokenUsage, provider: ModelProvider): ContextBreakdown[] {
  const input = usage.inputTokens ?? 0;
  const cacheCreation = usage.cacheCreationInputTokens ?? 0;
  const cacheRead = usage.cacheReadInputTokens ?? 0;

  if (provider === 'anthropic') {
    return [
      { label: 'Input', tokens: input },
      { label: 'Cache write', tokens: cacheCreation },
      { label: 'Cache read', tokens: cacheRead },
    ];
  }

  const cached = Math.min(input, cacheCreation + cacheRead);
  const uncached = Math.max(0, input - cached);
  const breakdown: ContextBreakdown[] = [{ label: 'Input', tokens: uncached }];

  if (cacheCreation > 0) {
    breakdown.push({ label: 'Cache write', tokens: Math.min(cacheCreation, cached) });
  }
  if (cacheRead > 0) {
    breakdown.push({ label: 'Cache read', tokens: Math.min(cacheRead, Math.max(0, cached - cacheCreation)) });
  }

  return breakdown;
}

export function computeContextUsage(
  messages: Message[],
  modelId: string | null,
  models: ModelInfo[],
  draftContent = '',
): ContextUsageSummary {
  const { contextWindow, provider } = resolveModelContext(modelId, models);
  const latestUsage = findLatestUsage(messages);
  const draftTokens = estimateTextTokens(draftContent);
  const draftBreakdown = draftTokens > 0 ? [{ label: 'Current draft', tokens: draftTokens }] : [];

  if (latestUsage) {
    const breakdown = [...usageBreakdown(latestUsage, provider), ...draftBreakdown];
    const total = breakdown.reduce((sum, item) => sum + item.tokens, 0);
    return {
      breakdown,
      total,
      max: contextWindow,
      source: draftTokens > 0 ? 'mixed' : 'real',
    };
  }

  const breakdown = [...estimateTranscript(messages), ...draftBreakdown];
  const total = breakdown.reduce((sum, item) => sum + item.tokens, 0);
  return { breakdown, total, max: contextWindow, source: 'estimate' };
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return String(tokens);
}
