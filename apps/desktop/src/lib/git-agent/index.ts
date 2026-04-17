/**
 * Git Agent — public entry points used across the frontend.
 *
 * Keeping a single barrel lets UI code import one thing regardless of which
 * internal module actually owns the implementation.
 */

export {
  openGitAgentSessionForDirtySwitch,
  type DirtySwitchArgs,
} from './session';
export { openGitAgentForDirtySwitch, type DirtySwitchContext } from './trigger';
export {
  GIT_AGENT_SYSTEM_PROMPT,
  GIT_AGENT_TOOL_ALLOWLIST,
  buildDirtySwitchSeed,
  type GitAgentTool,
  type DirtySwitchSeedArgs,
} from './systemPrompt';

const GIT_AGENT_NAME_PREFIX = 'Git Agent · ';

/**
 * Session-name convention: Git Agent sessions are created with a name
 * prefixed by `Git Agent · ...`. This lets the session list surface a badge
 * without a schema change. When server-side session kinds land, this helper
 * will read a typed field instead.
 */
export function isGitAgentSession(session: { readonly name?: string }): boolean {
  return typeof session.name === 'string' && session.name.startsWith(GIT_AGENT_NAME_PREFIX);
}

/**
 * Extract the "from → to" tail from a Git Agent session name. Returns `null`
 * when the session is not a Git Agent session, or has no tail (shouldn't
 * happen given the creator always sets one).
 */
export function gitAgentSubtitle(session: { readonly name?: string }): string | null {
  if (!session.name || !session.name.startsWith(GIT_AGENT_NAME_PREFIX)) return null;
  return session.name.slice(GIT_AGENT_NAME_PREFIX.length);
}
