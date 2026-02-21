/**
 * Tauri IPC wrappers for worktree operations
 */

import { invoke } from '@tauri-apps/api/core';
import type {
	WorktreeInfo,
	CreateWorktreeRequest,
	RemoveWorktreeRequest,
	WorktreeSetupConfig,
	WorktreeDiffEntry,
} from '../../bindings';

export async function listWorktrees(): Promise<WorktreeInfo[]> {
	return invoke<WorktreeInfo[]>('worktree_list');
}

export async function createWorktree(
	request: CreateWorktreeRequest
): Promise<WorktreeInfo> {
	return invoke<WorktreeInfo>('worktree_create', { request });
}

export async function removeWorktree(
	request: RemoveWorktreeRequest
): Promise<string | null> {
	return invoke<string | null>('worktree_remove', { request });
}

export async function getWorktree(id: string): Promise<WorktreeInfo> {
	return invoke<WorktreeInfo>('worktree_get', { id });
}

export async function setActiveWorktree(id: string | null): Promise<string | null> {
	return invoke<string | null>('worktree_set_active', { id });
}

export async function getActiveWorktree(): Promise<WorktreeInfo | null> {
	return invoke<WorktreeInfo | null>('worktree_get_active');
}

export async function lockWorktree(
	id: string,
	reason?: string
): Promise<void> {
	return invoke('worktree_lock', { id, reason });
}

export async function unlockWorktree(id: string): Promise<void> {
	return invoke('worktree_unlock', { id });
}

export async function pruneWorktrees(): Promise<string[]> {
	return invoke<string[]>('worktree_prune');
}

export async function bindAgent(
	worktreeId: string,
	sessionId: string
): Promise<void> {
	return invoke('worktree_bind_agent', { worktreeId, sessionId });
}

export async function unbindAgent(worktreeId: string): Promise<void> {
	return invoke('worktree_unbind_agent', { worktreeId });
}

export async function findByAgent(
	sessionId: string
): Promise<string | null> {
	return invoke<string | null>('worktree_find_by_agent', { sessionId });
}

export async function diffFromBase(
	worktreeId: string
): Promise<WorktreeDiffEntry[]> {
	return invoke<WorktreeDiffEntry[]>('worktree_diff_from_base', { worktreeId });
}

export async function promote(
	worktreeId: string,
	branchName: string
): Promise<void> {
	return invoke('worktree_promote', { worktreeId, branchName });
}

export async function setSetupCommands(
	config: WorktreeSetupConfig
): Promise<void> {
	return invoke('worktree_set_setup_commands', { config });
}

export async function getSetupCommands(): Promise<WorktreeSetupConfig> {
	return invoke<WorktreeSetupConfig>('worktree_get_setup_commands');
}
