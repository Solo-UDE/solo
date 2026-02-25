/**
 * Lightweight transcript refinement using Claude Haiku.
 * Takes a raw STT transcript and returns a cleaned-up version,
 * fixing transcription errors, removing filler words, and
 * correcting technical terms.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ClaudeCredentials } from './credentials.js';
import { createLogger } from './logger.js';

const logger = createLogger('RefineTranscript');

const SYSTEM_PROMPT = `You are a speech-to-text transcript refiner for a coding IDE. Given a raw voice transcript, clean it up by:
- Fixing obvious transcription errors (homophones, technical terms)
- Correcting casing for proper nouns, programming terms, and file names
- Removing filler words (um, uh, like) and false starts
- Preserving the user's intent and meaning exactly
- Keeping the natural speaking style (do not make it overly formal)

If context from recent chat messages is provided, use it to understand technical terms and proper nouns.

Output ONLY the refined transcript, nothing else. If the transcript is already clean, return it unchanged.`;

export async function refineTranscript(
  transcript: string,
  context?: string,
  apiKey?: string,
): Promise<string> {
  logger.info('Refining transcript...');

  let resolvedKey = apiKey;

  if (!resolvedKey) {
    resolvedKey = ClaudeCredentials.getApiKeyFromEnv() ?? undefined;
  }

  if (!resolvedKey) {
    throw new Error('No API key available for transcript refinement.');
  }

  const client = new Anthropic({ apiKey: resolvedKey });

  let userContent = `Refine this voice transcript:\n\n"${transcript}"`;
  if (context) {
    userContent += `\n\nRecent conversation context:\n${context}`;
  }

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });

  const text = response.content[0]?.type === 'text'
    ? response.content[0].text.trim()
    : '';
  logger.info({ originalLength: transcript.length, refinedLength: text.length }, 'Transcript refined');
  return text || transcript;
}
