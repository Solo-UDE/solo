/**
 * Git Agent system prompt + pre-seed builder.
 *
 * The prompt frames the model as a git-specialized helper that resolves
 * ambiguity around dirty worktrees, merge conflicts, failed pushes, and
 * branch switches. It emphasizes:
 *
 *  1. Plan before acting — inspect state with read-only commands first.
 *  2. Prefer reversible operations (stash) over destructive ones (discard).
 *  3. Ask the user before any destructive action.
 *  4. Use only git tools; never edit arbitrary source files.
 *
 * The tool allow-list is enforced separately by the agent infrastructure
 * (see `GIT_AGENT_TOOL_ALLOWLIST`). The prompt itself doesn't enumerate
 * allowed tools — that's the agent runtime's job — but it does remind the
 * model to stay within the git domain.
 */

export const GIT_AGENT_SYSTEM_PROMPT = `You are Solo's Git Agent — a specialized assistant that helps the user resolve git ambiguity.

You are invoked when a git operation would normally produce a scary CLI error (uncommitted changes blocking a branch switch, merge conflicts, failed pushes, detached HEAD, etc.). Your job is to move the user through the situation conversationally:

1. **Inspect first.** Start by running read-only commands (\`git status\`, \`git diff\`, \`git log\`) to understand the state. Don't propose fixes until you know what's there.

2. **Prefer reversible operations.** Stashes and new branches are safe; \`reset --hard\` and \`checkout -- .\` are not. Always start with the reversible option.

3. **Ask before anything destructive.** If the user needs to lose work (discard changes, force-push, delete unmerged branches), stop and ask for confirmation with a clear summary of what will be lost.

4. **Explain as you go.** The user may not know git deeply. After each action, give them a one-sentence summary of what changed and what their options are next.

5. **Stay in the git domain.** You have tools for git operations and read-only file inspection. You do **not** edit source files, run builds, or touch anything outside the repo's git state. If the user asks for something outside this scope, redirect them to the regular Solo agent.

When you finish resolving the original situation, state that clearly so the user knows they can close the session.`;

export interface DirtySwitchSeedArgs {
  readonly worktreeId: string;
  readonly fromBranch: string;
  readonly toBranch: string;
  readonly changedFileCount: number;
}

/**
 * First message the agent sees. Kept short — just enough context to let the
 * model take it from there. The full chat history is the user's domain.
 */
export function buildDirtySwitchSeed(args: DirtySwitchSeedArgs): string {
  const files = args.changedFileCount === 1 ? '1 file' : `${args.changedFileCount} files`;
  return [
    `I want to switch from \`${args.fromBranch}\` to \`${args.toBranch}\``,
    `but the worktree has uncommitted changes across ${files}.`,
    '',
    'Help me decide what to do with the changes (commit, stash, or discard)',
    'and then make the switch.',
    '',
    `Worktree id: ${args.worktreeId}`,
  ].join(' ').replace(/\s+/g, ' ').replace(
    /(\.) ([A-Z])/g,
    '$1\n\n$2',
  );
}

/**
 * Tool allow-list for Git Agent sessions. The agent runtime reads this to
 * filter its normal tool set down to git + read-only inspection.
 *
 * NOTE: this is a client-side hint today. When the backend gains first-class
 * per-session tool gating (tracked alongside Debug mode), the allow-list
 * moves server-side and this array becomes an IPC payload. Until then the
 * system prompt does the enforcement via instruction, which works reliably
 * for Claude-class models but is not a security boundary.
 */
export const GIT_AGENT_TOOL_ALLOWLIST = [
  // Inspection (read-only)
  'Bash', // constrained by permission rules to git-only commands
  'Read',
  'Grep',
  'Glob',
] as const;

export type GitAgentTool = (typeof GIT_AGENT_TOOL_ALLOWLIST)[number];
