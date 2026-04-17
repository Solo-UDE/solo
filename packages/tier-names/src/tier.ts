/**
 * Tier progression formula. Mirrors `infra/lambda/shared/tier.ts` exactly so
 * client and server compute identical tier/score for the same stats. If you
 * change the formula here, change it there too — drift breaks the leaderboard.
 */

import type { TierIndex } from "./pools";

const COMMIT_PIVOT = 5_000;
const TOKEN_PIVOT = 100_000_000;
const WORKTREE_PIVOT = 500;

const COMMIT_WEIGHT = 0.4;
const TOKEN_WEIGHT = 0.4;
const WORKTREE_WEIGHT = 0.2;

export interface TierBreakdown {
  readonly score: number;
  readonly tier: TierIndex;
  readonly tierProgress: number;
}

function logScore(value: number, pivot: number): number {
  if (value <= 0) return 0;
  const numerator = Math.log10(value + 1);
  const denominator = Math.log10(pivot);
  return Math.min(numerator / denominator, 1);
}

export function computeTier(commits: number, tokens: number, worktrees: number): TierBreakdown {
  const score =
    COMMIT_WEIGHT * logScore(commits, COMMIT_PIVOT) +
    TOKEN_WEIGHT * logScore(tokens, TOKEN_PIVOT) +
    WORKTREE_WEIGHT * logScore(worktrees, WORKTREE_PIVOT);

  const scaled = score * 7;
  const tier = Math.max(1, Math.min(7, 1 + Math.floor(scaled))) as TierIndex;
  const tierProgress = scaled - Math.floor(scaled);

  return { score, tier, tierProgress };
}
