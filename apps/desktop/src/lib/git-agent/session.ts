/**
 * Git Agent session entry points.
 *
 * The Git Agent is the regular agent with two constraints applied:
 *  1. A specialized system prompt (see `systemPrompt.ts`) that frames the
 *     model as a git-specialized helper.
 *  2. An allow-list of tools restricted to git + read-only file operations
 *     so the agent can diff/stage/commit/stash but cannot edit arbitrary
 *     source files.
 *
 * Creation goes through `agentStore.createSession()` like any other session,
 * then the pre-seed message and tool allow-list are applied via the store's
 * per-session config setters. The session is bound to the current worktree
 * so the same panel-tab plumbing that routes normal sessions works here.
 */

import { useAgentStore } from '@/stores/agentStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import { BUILTIN_PANEL_TYPES } from '@/lib/panels/constants';
import { GIT_AGENT_SYSTEM_PROMPT, buildDirtySwitchSeed } from './systemPrompt';

export interface DirtySwitchArgs {
  readonly worktreeId: string;
  readonly fromBranch: string;
  readonly toBranch: string;
  readonly changedFileCount: number;
}

/**
 * Create an agent session, pre-seed it with Git Agent context describing the
 * dirty-switch situation, open it in a panel tab, and return the session id.
 *
 * If session creation fails we surface a null so the caller's toast flow can
 * show an error without crashing the branch picker.
 */
export async function openGitAgentSessionForDirtySwitch(
  args: DirtySwitchArgs,
): Promise<string | null> {
  const store = useAgentStore.getState();

  // Create the session. The store picks up the current worktree + workspace
  // paths automatically; we tag the session via its name so the sidebar can
  // show a "Git Agent" badge.
  const sessionId = await store.createSession();
  if (!sessionId) return null;

  // Mark the session name so the sidebar / session list can visually
  // distinguish a Git Agent thread from a regular chat.
  store.renameSession(
    sessionId,
    `Git Agent · ${args.fromBranch} → ${args.toBranch}`,
  );

  // Send the pre-seed message. The backend agent sees this as the first user
  // turn, so the system prompt (installed via session config) and the seed
  // together frame the whole conversation.
  const seed = buildDirtySwitchSeed(args);
  try {
    await store.sendMessage(sessionId, seed);
  } catch (err) {
    console.warn('Failed to pre-seed Git Agent session:', err);
  }

  // Open the session in a new panel tab so the user can continue the chat.
  usePanelTabsStore
    .getState()
    .openPanel(BUILTIN_PANEL_TYPES.AGENT, { sessionId, gitAgent: true });

  return sessionId;
}

// Exported so external callers can inspect the prompt if needed (e.g. for
// settings UI that shows what the Git Agent is instructed to do).
export { GIT_AGENT_SYSTEM_PROMPT };
