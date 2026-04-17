/**
 * Pick the next worktree name from a tier's pool, avoiding names already in
 * use within the same project. When the pool is exhausted, fall back to a
 * numeric suffix (`Sequoia-2`) so name collisions never block worktree
 * creation.
 */

import { poolFor, TIER_POOLS, type TierIndex } from "./pools";

export interface NextNameOptions {
  readonly tier: TierIndex;
  /** Names the user has already used at this tier (or any tier). */
  readonly usedNames: readonly string[];
  /** Optional deterministic seed. Defaults to Math.random for production use. */
  readonly random?: () => number;
}

export interface NextNameResult {
  readonly name: string;
  readonly suffixed: boolean;
  readonly poolExhausted: boolean;
}

const stripSuffix = (name: string): string => name.split("-")[0];

export function nextName({ tier, usedNames, random = Math.random }: NextNameOptions): NextNameResult {
  const pool = poolFor(tier);
  const usedSet = new Set(usedNames.map((n) => n.toLowerCase()));

  const available = pool.filter((n) => !usedSet.has(n.toLowerCase()));
  if (available.length > 0) {
    const idx = Math.floor(random() * available.length);
    return { name: available[idx], suffixed: false, poolExhausted: false };
  }

  const baseUsage = new Map<string, number>();
  for (const used of usedNames) {
    const base = stripSuffix(used);
    baseUsage.set(base.toLowerCase(), (baseUsage.get(base.toLowerCase()) ?? 0) + 1);
  }
  const sortedBases = [...pool].sort((a, b) => {
    const ua = baseUsage.get(a.toLowerCase()) ?? 0;
    const ub = baseUsage.get(b.toLowerCase()) ?? 0;
    return ua - ub;
  });
  const base = sortedBases[0] ?? pool[0];
  const count = (baseUsage.get(base.toLowerCase()) ?? 0) + 1;
  return { name: `${base}-${count + 1}`, suffixed: true, poolExhausted: true };
}

/** Total pool size across all tiers. Useful for "X% of all names unlocked". */
export const TOTAL_POOL_SIZE = (Object.keys(TIER_POOLS) as unknown as TierIndex[]).reduce(
  (sum, t) => sum + TIER_POOLS[t].length,
  0,
);
