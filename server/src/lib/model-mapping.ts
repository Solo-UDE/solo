/**
 * Model mapping — maps Solo model IDs to Vercel AI SDK providers.
 *
 * These IDs must match the constants in:
 *   apps/desktop/src/lib/constants.ts
 */

import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';

export const modelMapping: Record<string, () => LanguageModel> = {
  // Anthropic — IDs from frontend constants.ts
  'claude-opus-4-6': () => anthropic('claude-opus-4-20250514'),
  'claude-sonnet-4-5-20250929': () => anthropic('claude-sonnet-4-5-20250514'),
  'claude-haiku-4-5-20251001': () => anthropic('claude-haiku-4-5-20250414'),

  // OpenAI
  'gpt-5.2-high': () => openai('gpt-4o'),
  'gpt-5.2-medium': () => openai('gpt-4o-mini'),
  'gpt-5.2-low': () => openai('gpt-4o-mini'),

  // Google
  'gemini-3-pro': () => google('gemini-2.5-pro-preview-05-06'),
  'gemini-3-flash': () => google('gemini-2.5-flash-preview-04-17'),
};

/**
 * Resolve a model ID to a Vercel AI SDK LanguageModel.
 * Falls back to Claude Sonnet 4.5 if the model ID is unknown.
 */
export function resolveModel(modelId: string): LanguageModel {
  const factory = modelMapping[modelId];
  if (factory) return factory();

  console.warn(`Unknown model ID "${modelId}", falling back to claude-sonnet-4-5`);
  return anthropic('claude-sonnet-4-5-20250514');
}
