export interface TierBreakdown {
  readonly score: number;
  readonly tier: number;
  readonly tierProgress: number;
}

function logScore(value: number, pivot: number): number {
  if (value <= 0) return 0;
  return Math.min(Math.log10(value + 1) / Math.log10(pivot), 1);
}

export function computeTier(
  commits: number,
  tokens: number,
  worktrees: number,
): TierBreakdown {
  const score =
    0.4 * logScore(commits, 5000) +
    0.4 * logScore(tokens, 100_000_000) +
    0.2 * logScore(worktrees, 500);

  const scaled = score * 7;
  const tier = Math.max(1, Math.min(7, 1 + Math.floor(scaled)));
  const tierProgress = scaled - Math.floor(scaled);

  return { score, tier, tierProgress };
}

export const TIER_NAMES: Record<number, string> = {
  1: "Trees",
  2: "Islands",
  3: "Rivers",
  4: "Winds",
  5: "Mountains",
  6: "Minerals",
  7: "Constellations",
};
