/**
 * Review Session — launches an Opus 4.6 agent session pre-loaded with
 * uncommitted diffs and aggregated intent from worktree sessions.
 */

import { gitGetBranchDiff } from '@/lib/tauri/git';
import { useAgentStore } from '@/stores/agentStore';
import { useGitStore } from '@/stores/gitStore';
import type { FileDiff } from '@/bindings/FileDiff';

const KIND_PREFIX: Record<string, string> = {
  add: '+',
  delete: '-',
  context: ' ',
};

function formatDiffsForReview(diffs: FileDiff[]): string {
  return diffs
    .map((d) => {
      const hunks = d.hunks
        .map((h) =>
          h.lines.map((l) => `${KIND_PREFIX[l.kind] ?? ' '}${l.content}`).join('\n'),
        )
        .join('\n');
      return `### ${d.path} (${d.status})\n\`\`\`diff\n${hunks}\n\`\`\``;
    })
    .join('\n\n');
}

function gatherWorktreeIntent(worktreeId: string): string {
  const { sessions, messages } = useAgentStore.getState();
  const worktreeSessions = Array.from(sessions.values()).filter(
    (s) => s.worktreeId === worktreeId,
  );

  if (worktreeSessions.length === 0) {
    return '_No prior agent sessions found in this worktree._';
  }

  const intents: string[] = [];
  for (const session of worktreeSessions) {
    const msgs = messages.get(session.id) ?? [];
    const userMessages = msgs
      .filter((m) => m.role === 'user')
      .map((m) => m.content.trim())
      .filter(Boolean);
    if (userMessages.length > 0) {
      const label = session.name ?? `Session ${session.id.slice(-6)}`;
      intents.push(`### ${label}\n${userMessages.join('\n\n')}`);
    }
  }

  return intents.length > 0
    ? intents.join('\n\n---\n\n')
    : '_Sessions exist but contain no user messages._';
}

function buildReviewPrompt(intent: string, diffs: string): string {
  return `You are a thorough code reviewer. Review the following uncommitted changes against the development intent.

## Developer Intent
The following are the developer's messages from agent sessions in this worktree — they describe what the developer was trying to accomplish:

${intent}

## Code Changes (Uncommitted)
The following diffs show all uncommitted changes in the worktree:

${diffs}

## Your Task
1. **Summarize** what the changes accomplish in 2-3 sentences
2. **Compare** the implementation against the stated intent — identify gaps, missing functionality, or deviations
3. **Review** code quality — potential bugs, edge cases, security issues, or anti-patterns
4. **Suggest** specific improvements or missing pieces that should be addressed

Be thorough but concise. Focus on actionable findings. If the changes look solid, say so.`;
}

/**
 * Launch a review agent session for the given worktree.
 * Gathers diffs + intent, creates an Opus session, sends the review prompt.
 * Returns the new session ID.
 */
export async function launchReviewSession(worktreeId?: string): Promise<string> {
  const currentBranch = useGitStore.getState().currentBranch;

  // Gather diffs
  const diffs = await gitGetBranchDiff(currentBranch);
  if (!diffs || diffs.length === 0) {
    throw new Error('No uncommitted changes to review');
  }

  const formattedDiffs = formatDiffsForReview(diffs);

  // Gather intent from worktree sessions
  const intent = worktreeId
    ? gatherWorktreeIntent(worktreeId)
    : '_No worktree context available._';

  const reviewPrompt = buildReviewPrompt(intent, formattedDiffs);

  // Create Opus session and send
  const agentStore = useAgentStore.getState();
  const sessionId = await agentStore.createSession('opus');
  await agentStore.sendMessage(sessionId, reviewPrompt);

  return sessionId;
}
