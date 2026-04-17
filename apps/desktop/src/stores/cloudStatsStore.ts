/**
 * Cloud stats / tier Zustand store.
 *
 * State shape
 *  - `snapshot`: pending delta + last-known cumulative (read from Rust local store)
 *  - `tier`: full TierInfo (tier, progress, unlocked name pool) fetched from cloud
 *  - `leaderboard`: top-N entries fetched lazily
 *
 * All cloud calls go through the Tauri bridge; the frontend never hits the
 * API Gateway directly. This keeps auth tokens server-side and lets the Rust
 * sync worker handle offline buffering transparently.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
	StatsSnapshot,
	CumulativeStats,
	TierInfo,
	LeaderboardEntry,
} from '../bindings';
import * as statsApi from '../lib/tauri/stats';

interface CloudStatsState {
	snapshot: StatsSnapshot | null;
	tier: TierInfo | null;
	leaderboard: LeaderboardEntry[];
	initializedAt: number | null;

	isInitializing: boolean;
	isSyncing: boolean;
	isLoadingLeaderboard: boolean;
	error: string | null;
}

interface CloudStatsActions {
	/** Call once per session after auth completes. Idempotent. */
	initialize: () => Promise<void>;
	/** Pull the latest local snapshot from Rust (no network). */
	refreshSnapshot: () => Promise<void>;
	/** Force cloud sync; refreshes cumulative on success. */
	syncNow: () => Promise<void>;
	/** Fetch current tier + unlocked name pool. */
	loadTier: () => Promise<void>;
	/** Fetch leaderboard; `limit` defaults to 100. */
	loadLeaderboard: (limit?: number) => Promise<void>;
	/** Generate a share card and return the signed URL. */
	generateCard: () => Promise<string>;
	clearError: () => void;
	reset: () => void;
}

type CloudStatsStore = CloudStatsState & CloudStatsActions;

const initialState: CloudStatsState = {
	snapshot: null,
	tier: null,
	leaderboard: [],
	initializedAt: null,
	isInitializing: false,
	isSyncing: false,
	isLoadingLeaderboard: false,
	error: null,
};

function errorMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (typeof err === 'string') return err;
	return 'Unknown error';
}

export const useCloudStatsStore = create<CloudStatsStore>()(
	immer((set, get) => ({
		...initialState,

		initialize: async () => {
			if (get().initializedAt) return;
			set((s) => {
				s.isInitializing = true;
				s.error = null;
			});
			try {
				await statsApi.initializeStats();
				const snap = await statsApi.getCurrentStats();
				set((s) => {
					s.snapshot = snap;
					s.initializedAt = Date.now();
				});
				void get().loadTier();
			} catch (err) {
				set((s) => {
					s.error = errorMessage(err);
				});
			} finally {
				set((s) => {
					s.isInitializing = false;
				});
			}
		},

		refreshSnapshot: async () => {
			try {
				const snap = await statsApi.getCurrentStats();
				set((s) => {
					s.snapshot = snap;
				});
			} catch (err) {
				set((s) => {
					s.error = errorMessage(err);
				});
			}
		},

		syncNow: async () => {
			set((s) => {
				s.isSyncing = true;
				s.error = null;
			});
			try {
				const cumulative = await statsApi.syncStatsNow();
				set((s) => {
					if (s.snapshot) {
						s.snapshot.cumulative = cumulative;
					} else {
						s.snapshot = {
							pending: {
								commits: 0n,
								tokens: 0n,
								worktrees: 0n,
								sessions: 0n,
								messages: 0n,
							},
							cumulative,
							lastSyncAt: new Date().toISOString(),
						};
					}
				});
			} catch (err) {
				set((s) => {
					s.error = errorMessage(err);
				});
			} finally {
				set((s) => {
					s.isSyncing = false;
				});
			}
		},

		loadTier: async () => {
			try {
				const tier = await statsApi.getMyTier();
				set((s) => {
					s.tier = tier;
				});
			} catch (err) {
				set((s) => {
					s.error = errorMessage(err);
				});
			}
		},

		loadLeaderboard: async (limit?: number) => {
			set((s) => {
				s.isLoadingLeaderboard = true;
			});
			try {
				const entries = await statsApi.getLeaderboard(limit);
				set((s) => {
					s.leaderboard = entries;
				});
			} catch (err) {
				set((s) => {
					s.error = errorMessage(err);
				});
			} finally {
				set((s) => {
					s.isLoadingLeaderboard = false;
				});
			}
		},

		generateCard: async () => {
			try {
				return await statsApi.generateShareCard();
			} catch (err) {
				const message = errorMessage(err);
				set((s) => {
					s.error = message;
				});
				throw new Error(message);
			}
		},

		clearError: () => {
			set((s) => {
				s.error = null;
			});
		},

		reset: () => {
			set(() => ({ ...initialState }));
		},
	}))
);

// =============================================================================
// Selectors
// =============================================================================

export const selectCumulative = (s: CloudStatsStore): CumulativeStats | null =>
	s.snapshot?.cumulative ?? null;

export const selectPendingIsDirty = (s: CloudStatsStore): boolean => {
	const p = s.snapshot?.pending;
	if (!p) return false;
	return (
		p.commits > 0n ||
		p.tokens > 0n ||
		p.worktrees > 0n ||
		p.sessions > 0n ||
		p.messages > 0n
	);
};
