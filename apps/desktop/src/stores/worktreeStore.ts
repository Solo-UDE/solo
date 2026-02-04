/**
 * Worktree Zustand Store
 * Manages git worktree state for parallel agent workflows
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import type { WorktreeInfo } from '../bindings';
import * as worktreeApi from '../lib/tauri/worktree';

enableMapSet();

const EMPTY_WORKTREES: WorktreeInfo[] = [];

interface WorktreeState {
	worktrees: Map<string, WorktreeInfo>;
	activeWorktreeId: string | null;
	isLoading: boolean;
	error: string | null;
}

interface WorktreeActions {
	loadWorktrees: () => Promise<void>;
	createWorktree: (branch: string, createBranch?: boolean, base?: string) => Promise<WorktreeInfo>;
	removeWorktree: (id: string, force?: boolean) => Promise<void>;
	setActive: (id: string | null) => Promise<void>;
	lock: (id: string, reason?: string) => Promise<void>;
	unlock: (id: string) => Promise<void>;

	// Event handlers (called from useWorktreeStream)
	handleWorktreeProgress: (worktreeId: string, message: string) => void;
	handleWorktreeReady: (worktreeId: string, info: WorktreeInfo) => void;
	handleWorktreeError: (worktreeId: string, error: string) => void;
	handleWorktreeRemoved: (worktreeId: string) => void;

	clearError: () => void;
}

type WorktreeStore = WorktreeState & WorktreeActions;

const initialState: WorktreeState = {
	worktrees: new Map(),
	activeWorktreeId: null,
	isLoading: false,
	error: null,
};

export const useWorktreeStore = create<WorktreeStore>()(
	immer((set, _get) => ({
		...initialState,

		loadWorktrees: async () => {
			set((state) => {
				state.isLoading = true;
				state.error = null;
			});

			try {
				const list = await worktreeApi.listWorktrees();
				set((state) => {
					state.worktrees = new Map(list.map((wt) => [wt.id, wt]));
					state.isLoading = false;
				});
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				set((state) => {
					state.error = msg;
					state.isLoading = false;
				});
			}
		},

		createWorktree: async (branch, createBranch = true, base) => {
			set((state) => {
				state.error = null;
			});

			const info = await worktreeApi.createWorktree({
				branch,
				path: null,
				create_branch: createBranch,
				base: base ?? null,
			});

			set((state) => {
				state.worktrees.set(info.id, info);
			});

			return info;
		},

		removeWorktree: async (id, force = false) => {
			await worktreeApi.removeWorktree({ id, force });

			set((state) => {
				state.worktrees.delete(id);
				if (state.activeWorktreeId === id) {
					state.activeWorktreeId = null;
				}
			});
		},

		setActive: async (id) => {
			await worktreeApi.setActiveWorktree(id);

			set((state) => {
				state.activeWorktreeId = id;
			});
		},

		lock: async (id, reason) => {
			await worktreeApi.lockWorktree(id, reason);

			set((state) => {
				const wt = state.worktrees.get(id);
				if (wt) {
					wt.is_locked = true;
					wt.lock_reason = reason ?? null;
				}
			});
		},

		unlock: async (id) => {
			await worktreeApi.unlockWorktree(id);

			set((state) => {
				const wt = state.worktrees.get(id);
				if (wt) {
					wt.is_locked = false;
					wt.lock_reason = null;
				}
			});
		},

		handleWorktreeProgress: (worktreeId, message) => {
			console.log(`[Worktree] Progress: ${worktreeId} - ${message}`);
		},

		handleWorktreeReady: (worktreeId, info) => {
			set((state) => {
				state.worktrees.set(worktreeId, info);
			});
		},

		handleWorktreeError: (worktreeId, error) => {
			console.error(`[Worktree] Error: ${worktreeId} - ${error}`);
			set((state) => {
				state.error = error;
			});
		},

		handleWorktreeRemoved: (worktreeId) => {
			set((state) => {
				state.worktrees.delete(worktreeId);
				if (state.activeWorktreeId === worktreeId) {
					state.activeWorktreeId = null;
				}
			});
		},

		clearError: () => {
			set((state) => {
				state.error = null;
			});
		},
	}))
);

// Selectors

export const useWorktreeList = (): WorktreeInfo[] => {
	const worktrees = useWorktreeStore((state) => state.worktrees);
	if (worktrees.size === 0) return EMPTY_WORKTREES;
	return Array.from(worktrees.values());
};

export const useActiveWorktree = (): WorktreeInfo | null => {
	const activeId = useWorktreeStore((state) => state.activeWorktreeId);
	const worktrees = useWorktreeStore((state) => state.worktrees);
	if (!activeId) return null;
	return worktrees.get(activeId) ?? null;
};

export const useWorktreeById = (id: string | null): WorktreeInfo | null => {
	const worktrees = useWorktreeStore((state) => state.worktrees);
	if (!id) return null;
	return worktrees.get(id) ?? null;
};
