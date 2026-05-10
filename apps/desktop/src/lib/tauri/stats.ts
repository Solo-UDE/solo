/**
 * Tauri IPC wrappers for the tier / gamification stats system.
 */

import { invoke } from '@tauri-apps/api/core';
import type {
	StatsSnapshot,
	CumulativeStats,
	TierInfo,
	LeaderboardEntry,
} from '../../bindings';

/**
 * Boot the local stats collector. Must be called once after the user is
 * authenticated. Safe to call again — the backend no-ops if already initialized.
 */
export async function initializeStats(): Promise<void> {
	return invoke<void>('stats_initialize');
}

/**
 * Snapshot of the user's local stats: pending delta queued for sync plus the
 * last cloud-hydrated cumulative counters. Fast — in-memory, no network call.
 */
export async function getCurrentStats(): Promise<StatsSnapshot> {
	return invoke<StatsSnapshot>('stats_current');
}

/** Force a sync with the cloud. Returns the fresh cumulative state on success. */
export async function syncStatsNow(): Promise<CumulativeStats> {
	return invoke<CumulativeStats>('stats_sync_now');
}

/** Fetch the current user's tier metadata and unlocked name pool. */
export async function getMyTier(): Promise<TierInfo> {
	return invoke<TierInfo>('stats_get_tier');
}

/**
 * Fetch the leaderboard. Without `tier`, returns the global board; with `tier`,
 * returns that tier's board. Default limit 100, capped server-side at 500.
 */
export async function getLeaderboard(limit?: number, tier?: number): Promise<LeaderboardEntry[]> {
	return invoke<LeaderboardEntry[]>('stats_get_leaderboard', { limit, tier });
}

/** Generate a shareable tier card and return a signed S3 URL. */
export async function generateShareCard(): Promise<string> {
	return invoke<string>('stats_generate_card');
}
