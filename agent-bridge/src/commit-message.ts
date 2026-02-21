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

export async function generateCommitMessage(diff: string): Promise<string> {
  logger.info('Generating commit message...');

  // Resolve credentials the same way the agent does
  const credentials = ClaudeCredentials.getCredentials();
  if (!credentials.hasCredentials) {
    throw new Error('No credentials found. Log in to Claude Code CLI or set ANTHROPIC_API_KEY.');
  }

  let client: Anthropic;
  if (credentials.type === 'oauth') {
    const token = ClaudeCredentials.getOAuthTokenFromKeychain();
    if (!token) throw new Error('OAuth token expired or unavailable');
    client = new Anthropic({ authToken: token });
  } else {
    const apiKey = ClaudeCredentials.getApiKeyFromEnv();
    if (!apiKey) throw new Error('API key was detected but is no longer available');
    client = new Anthropic({ apiKey });
  }

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
