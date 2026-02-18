import { execSync } from 'child_process';

import { createLogger } from './logger.js';

const logger = createLogger('ClaudeCredentials');

/**
 * Keychain credentials structure from Claude Code CLI
 */
interface KeychainCredentials {
  claudeAiOauth?: {
    accessToken?: string;
    expiresAt?: string;
  };
}

/**
 * Type guard to check if parsed JSON is valid KeychainCredentials
 */
function isKeychainCredentials(value: unknown): value is KeychainCredentials {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  if (obj.claudeAiOauth === undefined) {
    return true; // claudeAiOauth is optional
  }
  if (typeof obj.claudeAiOauth !== 'object' || obj.claudeAiOauth === null) {
    return false;
  }
  return true;
}

/**
 * Reads OAuth token from macOS Keychain where Claude Code CLI stores credentials
 * @returns OAuth access token if valid and not expired, null otherwise
 */
function getOAuthTokenFromKeychain(): string | null {
  try {
    // Execute macOS security command to read from Keychain
    const output = execSync('security find-generic-password -s "Claude Code-credentials" -w', {
      encoding: 'utf-8',
    }).trim();

    // Parse the JSON credentials structure
    const parsed: unknown = JSON.parse(output);
    if (!isKeychainCredentials(parsed)) {
      logger.debug('Invalid credentials structure in Keychain');
      return null;
    }

    const claudeAuth = parsed.claudeAiOauth;
    if (claudeAuth === undefined) {
      logger.debug('No Claude OAuth credentials found in Keychain');
      return null;
    }

    const accessToken = claudeAuth.accessToken;
    const expiresAt = claudeAuth.expiresAt;

    if (accessToken === undefined || accessToken === '') {
      logger.debug('OAuth token missing in Keychain credentials');
      return null;
    }

    // Validate token expiration
    if (expiresAt !== undefined && expiresAt !== '') {
      const expiryMs = parseInt(expiresAt, 10);
      const expiryDate = new Date(expiryMs);
      const now = new Date();

      if (now >= expiryDate) {
        logger.warn({ expiryDate: expiryDate.toISOString() }, 'Claude Code OAuth token expired');
        return null;
      }

      logger.debug({ expiryDate: expiryDate.toISOString() }, 'OAuth token valid');
    }

    return accessToken;
  } catch (error) {
    // Token not found in Keychain or parsing error
    if (error instanceof Error && error.message.includes('could not be found')) {
      logger.debug('Claude Code credentials not found in Keychain');
    } else {
      logger.error({ error }, 'Error reading OAuth token from Keychain');
    }
    return null;
  }
}

/**
 * Reads API key from environment variable (loaded from .env file)
 * @returns API key if present, null otherwise
 */
function getApiKeyFromEnv(): string | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (apiKey === undefined || apiKey === '') {
    logger.debug('ANTHROPIC_API_KEY not found in environment');
    return null;
  }

  return apiKey;
}

/**
 * Gets credentials with OAuth-first priority
 *
 * Important: When OAuth token is available, environment variables should be cleared
 * to allow the Claude Agent SDK to spawn CLI subprocess that reads from Keychain.
 *
 * @returns Object with credential info: { type: 'oauth' | 'apikey', hasCredentials: boolean }
 */
function getCredentials(): { type: 'oauth' | 'apikey'; hasCredentials: boolean } {
  // Try OAuth token first
  const oauthToken = getOAuthTokenFromKeychain();

  if (oauthToken !== null) {
    logger.info('OAuth token available from Claude Code Keychain');
    return { type: 'oauth', hasCredentials: true };
  }

  // Fall back to API key
  const apiKey = getApiKeyFromEnv();

  if (apiKey !== null) {
    logger.info('API key available from environment');
    return { type: 'apikey', hasCredentials: true };
  }

  // No credentials found
  logger.error('No credentials found (checked Keychain and .env)');
  return { type: 'apikey', hasCredentials: false };
}

/**
 * ClaudeCredentials - Manages authentication credentials for Claude Agent SDK
 *
 * Priority:
 * 1. OAuth token from macOS Keychain (same as Claude Code CLI)
 * 2. API key from .env file (fallback)
 */
export const ClaudeCredentials = {
  getOAuthTokenFromKeychain,
  getApiKeyFromEnv,
  getCredentials,
} as const;
