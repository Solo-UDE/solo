/**
 * Model mapping — maps Solo model IDs to Vercel AI SDK providers via OpenRouter.
 *
 * Single OPENROUTER_API_KEY gives access to all models.
 * Includes custom fetch middleware for:
 *   - Anthropic prompt caching (cache_control headers)
 *   - Anthropic fine-grained tool streaming
 *   - Google Vertex provider routing
 *
 * These IDs must match the constants in:
 *   apps/desktop/src/lib/constants.ts
 */

import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';

// =============================================================================
// Custom fetch middleware for OpenRouter
// =============================================================================

/**
 * Intercepts OpenRouter requests to add provider-specific optimizations:
 * - Anthropic: prompt caching via cache_control + fine-grained tool streaming
 * - Google: forces google-vertex provider (avoids google-ai-studio)
 */
const openrouterFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  if (!init?.body) return fetch(input, init);

  try {
    const body = JSON.parse(init.body as string);

    // Google models: force Vertex provider
    if (body?.model?.startsWith('google/')) {
      body.provider = {
        ...body?.provider,
        only: ['google-vertex'],
        allow_fallbacks: false,
        ignore: ['google-ai-studio'],
      };
      init.body = JSON.stringify(body);
    }

    // Anthropic models: add streaming header + prompt caching
    if (body?.model?.startsWith('anthropic/')) {
      init.headers = {
        ...init.headers,
        'x-anthropic-beta': 'fine-grained-tool-streaming-2025-05-14',
      };

      // Apply prompt caching to strategic message positions
      if (body?.messages) {
        const messages = body.messages;
        const indicesToCache = new Set<number>();

        // Always cache the last message
        if (messages.length > 0) {
          indicesToCache.add(messages.length - 1);
        }

        // Find user messages going backwards and cache the message before them
        const userMessageIndices: number[] = [];
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'user') {
            userMessageIndices.push(i);
          }
        }

        // Cache message before the last user message (context)
        if (userMessageIndices.length >= 1 && userMessageIndices[0] > 0) {
          indicesToCache.add(userMessageIndices[0] - 1);
        }

        // Cache message before the second-to-last user message
        if (userMessageIndices.length >= 2 && userMessageIndices[1] > 0) {
          indicesToCache.add(userMessageIndices[1] - 1);
        }

        // Cache the last system message
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'system') {
            indicesToCache.add(i);
            break;
          }
        }

        // Apply cache_control to selected messages
        for (const idx of indicesToCache) {
          const message = messages[idx];
          if (!message) continue;

          if (typeof message.content === 'string') {
            message.content = [{
              type: 'text',
              text: message.content,
              cache_control: { type: 'ephemeral' },
            }];
          } else if (Array.isArray(message.content)) {
            for (const item of message.content) {
              if (item && typeof item === 'object' && item.type === 'text') {
                item.cache_control = { type: 'ephemeral' };
                break;
              }
            }
          }
        }

        init.body = JSON.stringify(body);
      }
    }
  } catch {
    // If parsing fails, pass through unmodified
  }

  return fetch(input, init);
};

// =============================================================================
// Provider & Model Mapping
// =============================================================================

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
  fetch: openrouterFetch as typeof fetch,
});

export const modelMapping: Record<string, () => LanguageModel> = {
  // Anthropic
  'claude-opus-4-7[1m]': () => openrouter.chat('anthropic/claude-opus-4.7'),
  'claude-sonnet-4-6': () => openrouter.chat('anthropic/claude-sonnet-4.6'),
  'claude-sonnet-4-5-20250929': () => openrouter.chat('anthropic/claude-sonnet-4.5'),
  'claude-haiku-4-5-20251001': () => openrouter.chat('anthropic/claude-haiku-4.5'),

  // OpenAI (Solo IDs map to current OpenRouter slugs)
  'gpt-5.2-high': () => openrouter.chat('openai/gpt-4o'),
  'gpt-5.2-medium': () => openrouter.chat('openai/gpt-4o-mini'),
  'gpt-5.2-low': () => openrouter.chat('openai/gpt-4o-mini'),

  // Google (Solo IDs map to current OpenRouter slugs)
  'gemini-3-pro': () => openrouter.chat('google/gemini-2.5-pro'),
  'gemini-3-flash': () => openrouter.chat('google/gemini-2.5-flash'),
};

/**
 * Resolve a model ID to a Vercel AI SDK LanguageModel via OpenRouter.
 * Falls back to Claude Sonnet 4.6 if the model ID is unknown.
 */
export function resolveModel(modelId: string): LanguageModel {
  const factory = modelMapping[modelId];
  if (factory) return factory();

  console.warn(`Unknown model ID "${modelId}", falling back to claude-sonnet-4.6`);
  return openrouter.chat('anthropic/claude-sonnet-4.6');
}
