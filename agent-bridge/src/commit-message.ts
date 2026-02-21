/**
 * Lightweight commit message generation using Claude Haiku.
 * Takes a diff summary and returns a structured commit message.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ClaudeCredentials } from './credentials.js';
import { createLogger } from './logger.js';

const logger = createLogger('CommitMessage');

const SYSTEM_PROMPT = `You are a git commit message generator. Given a diff summary, generate a concise commit message following conventional commits format (type: description). Be specific about what changed. Output ONLY the commit message, no explanation.

Rules:
- Use lowercase type prefix: feat, fix, refactor, style, docs, test, chore
- Keep the summary line under 72 characters
- If changes span multiple areas, use the most significant type
- Be specific: "fix: resolve null pointer in user auth flow" not "fix: bug fix"`;

export async function generateCommitMessage(diff: string, apiKey?: string): Promise<string> {
  logger.info('Generating commit message...');

  // Prefer the API key passed from the Rust credential manager
  let resolvedKey = apiKey;

  if (!resolvedKey) {
    // Fall back to environment variable
    resolvedKey = ClaudeCredentials.getApiKeyFromEnv() ?? undefined;
  }

  if (!resolvedKey) {
    throw new Error('No API key available. Set one in Settings > AI or set ANTHROPIC_API_KEY.');
  }

  const client = new Anthropic({ apiKey: resolvedKey });

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Generate a commit message for these changes:\n\n${diff}`,
    }],
  });

  const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
  logger.info({ messageLength: text.length }, 'Commit message generated');
  return text;
}
