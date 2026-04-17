/**
 * Worktree auto-naming — glues the tier-names pool to the worktree create flow.
 *
 * The rule of thumb: a `+ New Worktree` click should never prompt the user for
 * text. The user's current tier determines which pool is unlocked; we pick a
 * still-unused name from that pool and prefix it with the user's configured
 * branch prefix (defaults to `solo/`). The resulting branch name looks like
 * `solo/thames` for a Rivers-tier user.
 *
 * Manual rename remains a one-action escape hatch via `worktree_rename`, but
 * the common case is "click + auto-name" with zero ceremony.
 */

import { nextName, type TierIndex } from '@solo/tier-names';
import type { WorktreeInfo } from '../bindings';

/**
 * Default branch prefix when the user hasn't overridden it in settings.
 * Kept generic so it works regardless of the specific project.
 */
export const DEFAULT_BRANCH_PREFIX = 'solo';

export interface PickedWorktreeName {
	/** Full branch name: `${prefix}/${lowercased pool name}`. */
	readonly branch: string;
	/** Raw pool name (e.g. `Thames`) — useful for UI display. */
	readonly poolName: string;
	/** True when the pool was exhausted and a numeric suffix was appended. */
	readonly suffixed: boolean;
	/** True when every name in the tier pool was already in use. */
	readonly poolExhausted: boolean;
}

/**
 * Strip any leading prefix and the `/` separator, returning just the last
 * segment. Keeps `isValidName()` checks and tier-pool-rank comparisons
 * consistent regardless of whether the user's prefix is `solo/`, `sachin/`,
 * or something custom.
 */
function stripPrefix(branch: string): string {
	const idx = branch.lastIndexOf('/');
	return idx >= 0 ? branch.slice(idx + 1) : branch;
}

/**
 * Produce the next worktree branch name for the given tier, given the set of
 * worktrees already in use in the project.
 *
 * Pool matching is case-insensitive and prefix-aware: a user with branches
 * `solo/thames` and `solo/amazon` will have "Thames" and "Amazon" marked as
 * used even if the pool originally listed them capitalized.
 */
export function pickWorktreeName(
	tier: TierIndex,
	existingWorktrees: readonly WorktreeInfo[],
	options?: {
		readonly prefix?: string;
		readonly random?: () => number;
	},
): PickedWorktreeName {
	const prefix = (options?.prefix ?? DEFAULT_BRANCH_PREFIX).replace(/\/+$/, '');
	const usedNames = existingWorktrees
		.map((wt) => wt.branch)
		.filter((b): b is string => typeof b === 'string' && b.length > 0)
		.map(stripPrefix);

	const { name, suffixed, poolExhausted } = nextName({
		tier,
		usedNames,
		random: options?.random,
	});

	const segment = name.toLowerCase();
	const branch = prefix.length > 0 ? `${prefix}/${segment}` : segment;

	return { branch, poolName: name, suffixed, poolExhausted };
}
