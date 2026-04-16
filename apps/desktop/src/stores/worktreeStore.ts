/**
 * Worktree Zustand Store
 * Manages git worktree state for parallel agent workflows
 */

import { useRef } from 'react';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';
import type { WorktreeInfo } from '../bindings';
import * as worktreeApi from '../lib/tauri/worktree';
import { wtLog, wtTrace, wtSnapshot } from '../lib/worktreeLogger';

enableMapSet();

const EMPTY_WORKTREES: WorktreeInfo[] = [];

interface WorktreeState {
	worktrees: Map<string, WorktreeInfo>;
	activeWorktreeId: string | null;
	isLoading: boolean;
	error: string | null;
	/** Setup command output lines per worktree */
	setupProgress: Map<string, string[]>;
	/** Saved workspace root for restoration when returning to main */
	_originalWorkspaceRoot: string | null;
}

interface WorktreeActions {
	loadWorktrees: () => Promise<void>;
	createWorktree: (branch: string, createBranch?: boolean, base?: string) => Promise<WorktreeInfo>;
	removeWorktree: (id: string, force?: boolean) => Promise<void>;
	setActive: (id: string | null) => Promise<void>;
	lock: (id: string, reason?: string) => Promise<void>;
	unlock: (id: string) => Promise<void>;
	pruneWorktrees: () => Promise<string[]>;

	// Event handlers (called from useWorktreeStream)
	handleWorktreeProgress: (worktreeId: string, message: string) => void;
	handleWorktreeReady: (worktreeId: string, info: WorktreeInfo) => void;
	handleWorktreeError: (worktreeId: string, error: string) => void;
	handleWorktreeRemoved: (worktreeId: string) => void;
	handleSetupProgress: (worktreeId: string, output: string, isComplete: boolean) => void;

	/** Create worktree → activate → start agent session in one step */
	startAgentInWorktree: (branch: string, model?: string) => Promise<string>;

	clearError: () => void;
}

type WorktreeStore = WorktreeState & WorktreeActions;

const initialState: WorktreeState = {
	worktrees: new Map(),
	activeWorktreeId: null,
	isLoading: false,
	error: null,
	setupProgress: new Map(),
	_originalWorkspaceRoot: null,
};

export const useWorktreeStore = create<WorktreeStore>()(
	immer((set, _get) => ({
		...initialState,

		loadWorktrees: async () => {
			// Optimistically clear so stale data from a previous repo never lingers
			set((state) => {
				state.isLoading = true;
				state.error = null;
				state.worktrees.clear();
			});

			try {
				const list = await wtTrace('loadWorktrees', {}, () => worktreeApi.listWorktrees());
				set((state) => {
					state.worktrees = new Map(list.map((wt) => [wt.id, wt]));
					state.isLoading = false;
				});
				wtLog('info', `loaded ${list.length} worktree(s)`, {
					action: 'loadWorktrees',
					counts: {
						total: list.length,
						existing: list.filter((w) => w.exists_on_disk).length,
						stale: list.filter((w) => !w.exists_on_disk).length,
					},
					ids: list.map((w) => w.id),
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

			const info = await wtTrace(
				'createWorktree',
				{ branch, createBranch, base: base ?? null },
				() =>
					worktreeApi.createWorktree({
						branch,
						path: null,
						create_branch: createBranch,
						base: base ?? null,
					}),
			);

			set((state) => {
				state.worktrees.set(info.id, info);
			});
			wtLog('info', 'worktree added to store', {
				action: 'createWorktree',
				...wtSnapshot(info),
			});

			return info;
		},

		removeWorktree: async (id, force = false) => {
			const before = _get().worktrees.get(id);
			const restoredPath = await wtTrace(
				'removeWorktree',
				{
					worktreeId: id,
					force,
					path: before?.path,
					existsOnDisk: before?.exists_on_disk,
				},
				() => worktreeApi.removeWorktree({ id, force }),
			);

			const wasActive = _get().activeWorktreeId === id;

			set((state) => {
				state.worktrees.delete(id);
				state.setupProgress.delete(id);
				if (state.activeWorktreeId === id) {
					state.activeWorktreeId = null;
					state._originalWorkspaceRoot = null;
				}
			});

			// If the removed worktree was active, re-scope explorer + git to main
			if (wasActive && restoredPath) {
				const { useFileExplorerStore } = await import('@/stores/fileExplorerStore');
				const { useGitStore } = await import('@/stores/gitStore');
				await useFileExplorerStore.getState().setRootPath(restoredPath);
				useGitStore.getState().stopPolling();
				useGitStore.getState().startPolling();
			}
		},

		setActive: async (id) => {
			// Capture current root before the backend swaps it
			const { useFileExplorerStore } = await import('@/stores/fileExplorerStore');
			const currentRoot = useFileExplorerStore.getState().rootPath;

			const targetPath = await wtTrace(
				'setActiveWorktree',
				{ worktreeId: id ?? '<main>', currentRoot },
				() => worktreeApi.setActiveWorktree(id),
			);

			set((state) => {
				if (id !== null && state._originalWorkspaceRoot === null) {
					state._originalWorkspaceRoot = currentRoot;
				}
				if (id === null) {
					state._originalWorkspaceRoot = null;
				}
				state.activeWorktreeId = id;
			});

			// Re-scope file explorer + git to the target path
			if (targetPath) {
				const { useGitStore } = await import('@/stores/gitStore');
				await useFileExplorerStore.getState().setRootPath(targetPath);
				useGitStore.getState().setCommitMessage('');
				useGitStore.getState().stopPolling();
				useGitStore.getState().startPolling();
			}
		},

		lock: async (id, reason) => {
			await wtTrace('lockWorktree', { worktreeId: id, reason }, () =>
				worktreeApi.lockWorktree(id, reason),
			);

			set((state) => {
				const wt = state.worktrees.get(id);
				if (wt) {
					wt.is_locked = true;
					wt.lock_reason = reason ?? null;
				}
			});
		},

		unlock: async (id) => {
			await wtTrace('unlockWorktree', { worktreeId: id }, () =>
				worktreeApi.unlockWorktree(id),
			);

			set((state) => {
				const wt = state.worktrees.get(id);
				if (wt) {
					wt.is_locked = false;
					wt.lock_reason = null;
				}
			});
		},

		pruneWorktrees: async () => {
			const activeId = _get().activeWorktreeId;
			const originalRoot = _get()._originalWorkspaceRoot;
			const pruned = await wtTrace('pruneWorktrees', { activeId }, () =>
				worktreeApi.pruneWorktrees(),
			);
			wtLog('info', `pruned ${pruned.length} stale worktree(s)`, {
				action: 'pruneWorktrees',
				prunedIds: pruned,
			});

			let activeWasPruned = false;
			set((state) => {
				for (const id of pruned) {
					state.worktrees.delete(id);
					state.setupProgress.delete(id);
					if (state.activeWorktreeId === id) {
						state.activeWorktreeId = null;
						state._originalWorkspaceRoot = null;
						activeWasPruned = true;
					}
				}
			});

			// If the active worktree was pruned, backend already restored workspace_root;
			// re-scope the frontend too
			if (activeWasPruned && activeId && originalRoot) {
				const { useFileExplorerStore } = await import('@/stores/fileExplorerStore');
				const { useGitStore } = await import('@/stores/gitStore');
				await useFileExplorerStore.getState().setRootPath(originalRoot);
				useGitStore.getState().stopPolling();
				useGitStore.getState().startPolling();
			}

			return pruned;
		},

		handleWorktreeProgress: (worktreeId, message) => {
			console.log(`[Worktree] Progress: ${worktreeId} - ${message}`);
		},

		handleWorktreeReady: (worktreeId, info) => {
			set((state) => {
				state.worktrees.set(worktreeId, info);
				// Clear setup progress once the worktree is ready
				state.setupProgress.delete(worktreeId);
			});
		},

		handleWorktreeError: (worktreeId, error) => {
			console.error(`[Worktree] Error: ${worktreeId} - ${error}`);
			set((state) => {
				state.error = error;
			});
		},

		handleWorktreeRemoved: (worktreeId) => {
			const wasActive = _get().activeWorktreeId === worktreeId;
			const originalRoot = _get()._originalWorkspaceRoot;

			set((state) => {
				state.worktrees.delete(worktreeId);
				state.setupProgress.delete(worktreeId);
				if (state.activeWorktreeId === worktreeId) {
					state.activeWorktreeId = null;
					state._originalWorkspaceRoot = null;
				}
			});

			// If the removed worktree was active, re-scope to main asynchronously
			if (wasActive && originalRoot) {
				import('@/stores/fileExplorerStore').then(({ useFileExplorerStore }) => {
					useFileExplorerStore.getState().setRootPath(originalRoot);
				});
				import('@/stores/gitStore').then(({ useGitStore }) => {
					useGitStore.getState().stopPolling();
					useGitStore.getState().startPolling();
				});
			}
		},

		handleSetupProgress: (worktreeId, output, isComplete) => {
			set((state) => {
				let lines = state.setupProgress.get(worktreeId) ?? [];

				// Cap at 200 lines to prevent unbounded growth
				if (lines.length >= 200) {
					lines = lines.slice(-100);
				}
				lines.push(output);
				state.setupProgress.set(worktreeId, lines);

				if (isComplete) {
					lines.push('Setup complete');
					state.setupProgress.set(worktreeId, lines);
				}
			});
		},

		startAgentInWorktree: async (branch, model) => {
			const wt = await _get().createWorktree(branch, true);
			await _get().setActive(wt.id);
			const { useAgentStore } = await import('@/stores/agentStore');
			const sessionId = await useAgentStore.getState().createSession(model);
			return sessionId;
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

export const useWorktreeCount = (): number => {
	return useWorktreeStore((state) => state.worktrees.size);
};

const EMPTY_SESSION_SET = new Set<string>();

/**
 * Returns a stable Set of agent_session_id values from all non-main worktrees.
 * Uses ref-based caching to avoid re-renders when the set contents haven't changed.
 */
export function useWorktreeBoundSessionIds(): Set<string> {
	const prevRef = useRef<{ key: string; result: Set<string> }>({ key: '', result: EMPTY_SESSION_SET });

	return useWorktreeStore((state) => {
		const ids: string[] = [];
		for (const wt of state.worktrees.values()) {
			if (!wt.is_main && wt.agent_session_id) {
				ids.push(wt.agent_session_id);
			}
		}
		ids.sort();
		const key = ids.join(',');

		if (key === prevRef.current.key) {
			return prevRef.current.result;
		}

		const result = new Set(ids);
		prevRef.current = { key, result };
		return result;
	});
}
