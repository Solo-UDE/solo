/**
 * Reactive tier/stats hook for UI components.
 *
 * Returns everything a Journey-style component needs in one call:
 *  - Current cumulative stats + pending delta
 *  - Tier number, emoji, name, tagline, % progress to next tier
 *  - Next-available worktree name (tier pool awareness)
 *  - Cloud loading/error flags
 *
 * Reads from `cloudStatsStore`. If stats haven't been initialized yet, returns
 * zeros + tier 1 so the UI can render immediately without an empty state.
 */

import { useMemo } from 'react';
import {
	TIER_META,
	type TierIndex,
	type TierMeta,
	nextName,
	computeTier,
} from '@solo/tier-names';
import type { CumulativeStats, StatsSnapshot, TierInfo } from '../bindings';
import {
	selectCumulative,
	selectPendingIsDirty,
	useCloudStatsStore,
} from '../stores/cloudStatsStore';

export interface UseTierStatsResult {
	readonly snapshot: StatsSnapshot | null;
	readonly cumulative: CumulativeStats;
	readonly tier: TierIndex;
	readonly tierMeta: TierMeta;
	readonly tierProgress: number;
	readonly score: number;
	readonly serverTier: TierInfo | null;
	readonly pendingIsDirty: boolean;
	readonly isInitializing: boolean;
	readonly isSyncing: boolean;
	readonly error: string | null;
	readonly initialize: () => Promise<void>;
	readonly syncNow: () => Promise<void>;
	readonly refresh: () => Promise<void>;
	readonly pickNextWorktreeName: (usedNames: readonly string[]) => {
		name: string;
		suffixed: boolean;
		poolExhausted: boolean;
	};
}

const ZERO_CUMULATIVE: CumulativeStats = {
	commits: 0n,
	tokens: 0n,
	worktrees: 0n,
	sessions: 0n,
	messages: 0n,
	tier: 1,
	tierProgress: 0,
	score: 0,
	streakCurrent: 0,
	streakLongest: 0,
	lastActive: null,
};

const asTierIndex = (n: number): TierIndex => {
	const clamped = Math.max(1, Math.min(7, Math.round(n)));
	return clamped as TierIndex;
};

export function useTierStats(): UseTierStatsResult {
	const snapshot = useCloudStatsStore((s) => s.snapshot);
	const serverTier = useCloudStatsStore((s) => s.tier);
	const isInitializing = useCloudStatsStore((s) => s.isInitializing);
	const isSyncing = useCloudStatsStore((s) => s.isSyncing);
	const error = useCloudStatsStore((s) => s.error);
	const pendingIsDirty = useCloudStatsStore(selectPendingIsDirty);
	const initialize = useCloudStatsStore((s) => s.initialize);
	const syncNow = useCloudStatsStore((s) => s.syncNow);
	const refresh = useCloudStatsStore((s) => s.refreshSnapshot);
	const cumulative = useCloudStatsStore(selectCumulative) ?? ZERO_CUMULATIVE;

	const { tier, tierProgress, score } = useMemo(() => {
		// Prefer locally-computed values for responsiveness — the cloud's values
		// will overwrite these on the next sync but shouldn't leave the UI blank
		// in the meantime.
		const effectiveCommits =
			cumulative.commits + (snapshot?.pending.commits ?? 0n);
		const effectiveTokens =
			cumulative.tokens + (snapshot?.pending.tokens ?? 0n);
		const effectiveWorktrees =
			cumulative.worktrees + (snapshot?.pending.worktrees ?? 0n);
		const breakdown = computeTier(
			Number(effectiveCommits),
			Number(effectiveTokens),
			Number(effectiveWorktrees)
		);
		return {
			tier: asTierIndex(breakdown.tier),
			tierProgress: breakdown.tierProgress,
			score: breakdown.score,
		};
	}, [cumulative, snapshot]);

	const tierMeta = TIER_META[tier];

	const pickNextWorktreeName = useMemo(
		() => (usedNames: readonly string[]) =>
			nextName({ tier, usedNames }),
		[tier]
	);

	return {
		snapshot,
		cumulative,
		tier,
		tierMeta,
		tierProgress,
		score,
		serverTier,
		pendingIsDirty,
		isInitializing,
		isSyncing,
		error,
		initialize,
		syncNow,
		refresh,
		pickNextWorktreeName,
	};
}
