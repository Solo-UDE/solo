/**
 * Tool Permission Policy Engine
 *
 * Categorizes tools into tiers and evaluates whether a tool call
 * should be auto-approved, prompted, or denied based on the active
 * policy and session context (e.g., worktree isolation).
 */

import { createLogger } from './logger.js';

const logger = createLogger('ToolPolicy');

// Tool permission tiers
//   0 = read-only / safe — always auto-approve
//   1 = write / build — auto-approve in worktree, ask in main
//   2 = execute / destructive — always ask
//   3 = dangerous — always deny (reserved)
export type ToolTier = 0 | 1 | 2 | 3;

export type PolicyMode = 'ask-all' | 'smart' | 'approve-all';

export type PolicyDecision = 'auto-approve' | 'prompt' | 'deny';

export interface PolicyContext {
  /** Whether the session is running inside a worktree (not main workspace) */
  isWorktreeSession: boolean;
}

// Tier 0: Read-only, search, navigation — always safe
const TIER_0_TOOLS = new Set([
  'Read',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'Task',
  'TodoWrite',
  'AskUserQuestion',
  'ListMcpResourcesTool',
  'ReadMcpResourceTool',
]);

// Tier 1: File mutations, safe builds — auto in worktree
const TIER_1_TOOLS = new Set([
  'Write',
  'Edit',
  'NotebookEdit',
  'ExitPlanMode',
]);

// Tier 2: Shell execution, process control — always ask
const TIER_2_TOOLS = new Set([
  'Bash',
  'BashOutput',
  'KillShell',
]);

function getToolTier(toolName: string): ToolTier {
  if (TIER_0_TOOLS.has(toolName)) return 0;
  if (TIER_1_TOOLS.has(toolName)) return 1;
  if (TIER_2_TOOLS.has(toolName)) return 2;
  // Unknown tools default to Tier 2 (prompt)
  return 2;
}

/**
 * Evaluate whether a tool call should be auto-approved, prompted, or denied.
 */
export function evaluatePolicy(
  toolName: string,
  mode: PolicyMode,
  context: PolicyContext,
): PolicyDecision {
  // Mode overrides
  if (mode === 'approve-all') return 'auto-approve';
  if (mode === 'ask-all') return 'prompt';

  // Smart mode: tier-based evaluation
  const tier = getToolTier(toolName);

  switch (tier) {
    case 0:
      return 'auto-approve';

    case 1:
      // Auto-approve file writes in worktree sessions (isolated environment)
      if (context.isWorktreeSession) {
        logger.debug({ toolName, tier }, 'Auto-approving Tier 1 tool in worktree');
        return 'auto-approve';
      }
      return 'prompt';

    case 2:
      return 'prompt';

    case 3:
      return 'deny';

    default:
      return 'prompt';
  }
}

/** Get the tier for a tool (exposed for UI display) */
export { getToolTier };
