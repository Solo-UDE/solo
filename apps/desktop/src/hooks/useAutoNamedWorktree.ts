/**
 * One-call hook for auto-named worktree creation.
 *
 * Composes the user's current tier (from `cloudStatsStore`) with the list
 * of worktrees already in use (from `worktreeStore`) to pick a fresh name
 * from the tier's pool, then creates the worktree via the existing
 * `createWorktree` action.
 *
 * Consumers (the new Dev sidebar's "+ New Worktree" button) just invoke the
 * returned callback — no modal, no branch-name prompt, no ceremony. The UI
 * can offer a right-click rename afterward for users who want something
 * specific.
 */

import { useCallback } from 'react';
import type { WorktreeInfo } from '../bindings';
import {
	pickWorktreeName,
	type PickedWorktreeName,
} from '../lib/worktreeNaming';
import { useWorktreeStore } from '../stores/worktreeStore';
import { useTierStats } from './useTierStats';

export interface AutoNamedCreateResult {
	readonly worktree: WorktreeInfo;
	readonly pick: PickedWorktreeName;
}

export function useAutoNamedWorktreeCreator(): {
	readonly createAutoNamed: (options?: {
		readonly prefix?: string;
	}) => Promise<AutoNamedCreateResult>;
} {
	const { tier } = useTierStats();
	const createWorktree = useWorktreeStore((s) => s.createWorktree);

	const createAutoNamed = useCallback(
		async (options?: { readonly prefix?: string }): Promise<AutoNamedCreateResult> => {
			// Read once at call time so the picker sees an up-to-date list.
			const existing = Array.from(
				useWorktreeStore.getState().worktrees.values(),
			);
			const pick = pickWorktreeName(tier, existing, options);
			const worktree = await createWorktree(pick.branch, true);
			return { worktree, pick };
		},
		[tier, createWorktree],
	);

	return { createAutoNamed };
}
