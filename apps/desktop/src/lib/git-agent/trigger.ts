/**
 * Git Agent trigger — the one-line surface by which any UI surface can spawn
 * a specialized agent session to help resolve a git snag.
 *
 * Today the implementation lives in `./session.ts` (Phase 3E) and handles
 * agent creation + restricted tool allow-list + pre-seeded context. This file
 * is kept thin so callers don't need to know any of that; they just describe
 * the situation and let the agent take it from there.
 */

import { toast } from 'sonner';
import { openGitAgentSessionForDirtySwitch } from './session';

export interface DirtySwitchContext {
  readonly worktreeId: string;
  readonly fromBranch: string;
  readonly toBranch: string;
  readonly changedFileCount: number;
}

/**
 * Called when the user picks a branch while the active worktree has dirty
 * changes. Opens a pre-seeded Git Agent session and surfaces a toast so the
 * user knows where the follow-up is happening.
 */
export function openGitAgentForDirtySwitch(ctx: DirtySwitchContext): void {
  void openGitAgentSessionForDirtySwitch(ctx).then(
    (sessionId) => {
      if (!sessionId) return;
      toast.info('Git Agent session started', {
        description: `Solo will help you switch from ${ctx.fromBranch} to ${ctx.toBranch}.`,
      });
    },
    (err: unknown) => {
      toast.error('Could not start Git Agent', {
        description: err instanceof Error ? err.message : String(err),
      });
    },
  );
}
