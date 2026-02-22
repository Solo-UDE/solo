/**
 * Lightweight session title generation using Claude Haiku.
 * Takes a user message and assistant response, returns a concise title.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ClaudeCredentials } from './credentials.js';
import { createLogger } from './logger.js';

const logger = createLogger('SessionTitle');

const SYSTEM_PROMPT = `You are a session title generator. Given a user message and an AI assistant response, generate a concise title that captures the essence of the conversation topic.

Rules:
- Keep the title under 50 characters
- Use title case
- Be specific and descriptive
- Do not use quotes or special formatting
- Do not start with "Help with" or "Question about"
- Output ONLY the title, nothing else`;

export async function generateSessionTitle(
  userMessage: string,
  assistantMessage: string,
  apiKey?: string,
): Promise<string> {
  logger.info('Generating session title...');

  let resolvedKey = apiKey;

  if (!resolvedKey) {
    resolvedKey = ClaudeCredentials.getApiKeyFromEnv() ?? undefined;
  }

  if (!resolvedKey) {
    throw new Error('No API key available. Set one in Settings > AI or set ANTHROPIC_API_KEY.');
  }

  const client = new Anthropic({ apiKey: resolvedKey });

  // Truncate inputs to keep the request lightweight
  const truncatedUser = userMessage.slice(0, 500);
  const truncatedAssistant = assistantMessage.slice(0, 500);

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 60,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `User message:\n${truncatedUser}\n\nAssistant response:\n${truncatedAssistant}`,
    }],
  });

  const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
  logger.info({ titleLength: text.length }, 'Session title generated');
  return text;
}
