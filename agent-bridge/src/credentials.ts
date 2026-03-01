import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

import { createLogger } from './logger.js';

const logger = createLogger('ClaudeCredentials');

// Mirror constants from Rust credentials.rs
const CLAUDE_CODE_OAUTH_CLIENT_ID = 'claude-desktop';
const CLAUDE_CODE_TOKEN_ENDPOINT = 'https://api.anthropic.com/v1/oauth/token';
const EXPIRY_BUFFER_MS = 300_000; // 5 minutes — same as Rust side

/**
 * Credentials file structure from Claude Code CLI (~/.claude/.credentials.json)
 */
interface ClaudeCredentialsFile {
  claudeAiOauth?: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number | string;
  };
}

/**
 * Type guard to check if parsed JSON is valid ClaudeCredentialsFile
 */
function isClaudeCredentialsFile(value: unknown): value is ClaudeCredentialsFile {
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
 * Refresh an expired OAuth token using the refresh_token grant.
 * Mirrors Rust `refresh_claude_code_token()` in credentials.rs.
 * @returns New access token on success, null on any failure
 */
async function refreshOAuthToken(refreshToken: string): Promise<string | null> {
  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLAUDE_CODE_OAUTH_CLIENT_ID,
      refresh_token: refreshToken,
    });

    const resp = await fetch(CLAUDE_CODE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      logger.warn({ status: resp.status }, 'Claude Code token refresh failed');
      return null;
    }

    const data = (await resp.json()) as Record<string, unknown>;
    const accessToken = data.access_token;
    if (typeof accessToken === 'string' && accessToken !== '') {
      logger.info('Successfully refreshed Claude Code OAuth token');
      return accessToken;
    }

    logger.warn('Token refresh response missing access_token');
    return null;
  } catch (error) {
    logger.error({ error }, 'Error refreshing OAuth token');
    return null;
  }
}

/**
 * Check whether a token expiry timestamp (ms) is expired, with 5-min buffer.
 */
function isTokenExpired(expiryMs: number): boolean {
  return Date.now() >= expiryMs - EXPIRY_BUFFER_MS;
}

/**
 * Shared logic for resolving an OAuth token from parsed credentials.
 */
async function resolveOAuthFromParsed(
  parsed: ClaudeCredentialsFile,
  source: string
): Promise<string | null> {
  const claudeAuth = parsed.claudeAiOauth;
  if (claudeAuth === undefined) {
    logger.debug(`No Claude OAuth credentials in ${source}`);
    return null;
  }

  const accessToken = claudeAuth.accessToken;
  const expiresAt = claudeAuth.expiresAt;

  if (accessToken === undefined || accessToken === '') {
    logger.debug(`OAuth token missing in ${source} credentials`);
    return null;
  }

  if (expiresAt !== undefined && expiresAt !== '') {
    const expiryMs = typeof expiresAt === 'number' ? expiresAt : parseInt(expiresAt, 10);

    if (isTokenExpired(expiryMs)) {
      logger.warn({ expiryDate: new Date(expiryMs).toISOString() }, `OAuth token expired in ${source}, attempting refresh`);

      const refreshToken = claudeAuth.refreshToken;
      if (refreshToken !== undefined && refreshToken !== '') {
        const newToken = await refreshOAuthToken(refreshToken);
        if (newToken !== null) {
          return newToken;
        }
        logger.warn(`Failed to refresh OAuth token from ${source}`);
      } else {
        logger.debug(`No refreshToken in ${source} credentials`);
      }

      return null;
    }

    logger.debug({ expiryDate: new Date(expiryMs).toISOString() }, `OAuth token valid from ${source}`);
  }

  return accessToken;
}

/**
 * Reads OAuth token from ~/.claude/.credentials.json (primary OAuth source).
 * This file is always complete — no size limits unlike macOS `security` CLI.
 * Mirrors Rust `get_claude_oauth_from_file()` in credentials.rs.
 * @returns OAuth access token if valid/refreshable, null otherwise
 */
async function getOAuthTokenFromFile(): Promise<string | null> {
  try {
    const credPath = join(homedir(), '.claude', '.credentials.json');
    const content = readFileSync(credPath, 'utf-8');
    const parsed: unknown = JSON.parse(content);

    if (!isClaudeCredentialsFile(parsed)) {
      logger.debug('Invalid credentials structure in ~/.claude/.credentials.json');
      return null;
    }

    return resolveOAuthFromParsed(parsed, '~/.claude/.credentials.json');
  } catch {
    // File doesn't exist or isn't readable — expected in many setups
    logger.debug('Could not read ~/.claude/.credentials.json');
    return null;
  }
}

/**
 * Reads OAuth token from macOS Keychain (fallback when file doesn't exist).
 * Claude Code CLI stores credentials under service "Claude Code-credentials".
 * @returns OAuth access token if valid/refreshable, null otherwise
 */
async function getOAuthTokenFromKeychain(): Promise<string | null> {
  if (process.platform !== 'darwin') {
    logger.debug('Keychain lookup skipped — not macOS');
    return null;
  }

  try {
    const raw = execFileSync(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { encoding: 'utf-8', timeout: 5_000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    const parsed: unknown = JSON.parse(raw);

    if (!isClaudeCredentialsFile(parsed)) {
      logger.debug('Invalid credentials structure in macOS Keychain');
      return null;
    }

    return resolveOAuthFromParsed(parsed, 'macOS Keychain');
  } catch {
    // Keychain item not found, parse error, or non-macOS — all expected
    logger.debug('Could not read credentials from macOS Keychain');
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
 * to allow the Claude Agent SDK to spawn CLI subprocess that reads from ~/.claude/.credentials.json.
 *
 * @returns Object with credential info: { type: 'oauth' | 'apikey', hasCredentials: boolean }
 */
async function getCredentials(): Promise<{ type: 'oauth' | 'apikey'; hasCredentials: boolean }> {
  // 1. Try OAuth token from ~/.claude/.credentials.json (with refresh on expiry)
  const fileToken = await getOAuthTokenFromFile();
  if (fileToken !== null) {
    logger.info('OAuth token available from ~/.claude/.credentials.json');
    return { type: 'oauth', hasCredentials: true };
  }

  // 2. Try OAuth token from macOS Keychain (fallback when file doesn't exist)
  const keychainToken = await getOAuthTokenFromKeychain();
  if (keychainToken !== null) {
    logger.info('OAuth token available from macOS Keychain');
    return { type: 'oauth', hasCredentials: true };
  }

  // 3. Fall back to API key from environment
  const apiKey = getApiKeyFromEnv();
  if (apiKey !== null) {
    logger.info('API key available from environment');
    return { type: 'apikey', hasCredentials: true };
  }

  // No credentials found
  logger.error('No credentials found (checked ~/.claude/.credentials.json, macOS Keychain, and env)');
  return { type: 'apikey', hasCredentials: false };
}

/**
 * ClaudeCredentials - Manages authentication credentials for Claude Agent SDK
 *
 * Priority:
 * 1. OAuth token from ~/.claude/.credentials.json (with refresh on expiry)
 * 2. OAuth token from macOS Keychain (fallback when file doesn't exist)
 * 3. API key from environment variable
 */
export const ClaudeCredentials = {
  getOAuthTokenFromFile,
  getOAuthTokenFromKeychain,
  getApiKeyFromEnv,
  getCredentials,
} as const;
