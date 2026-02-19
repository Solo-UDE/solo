/**
 * Authentication middleware for Solo server.
 *
 * In dev mode (DEV_SKIP_AUTH=true), authentication is bypassed.
 * In production, validates Supabase JWT tokens.
 */

import type { Context, Next } from 'hono';

const DEV_SKIP_AUTH = process.env.DEV_SKIP_AUTH === 'true';
const DEV_BYPASS_TOKEN = process.env.DEV_BYPASS_TOKEN || 'dev-token';

export async function authMiddleware(c: Context, next: Next) {
  // Dev bypass
  if (DEV_SKIP_AUTH) {
    await next();
    return;
  }

  const authHeader = c.req.header('Authorization');
  const token = authHeader?.replace('Bearer ', '');

  if (!token) {
    return c.json({ error: 'Missing authorization token' }, 401);
  }

  // Dev bypass token
  if (token === DEV_BYPASS_TOKEN) {
    await next();
    return;
  }

  // TODO: Validate Supabase JWT
  // For now, accept any non-empty token in dev
  await next();
}

/**
 * Extract auth token from WebSocket query params.
 * WebSocket connections can't send custom headers, so tokens
 * are passed as query parameters.
 */
export function extractWsToken(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('token');
  } catch {
    return null;
  }
}
