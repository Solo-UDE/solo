/**
 * Tauri IPC wrappers for worktree operations
 */

import { invoke } from '@tauri-apps/api/core';
import type {
	WorktreeInfo,
	CreateWorktreeRequest,
	RemoveWorktreeRequest,
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
): Promise<void> {
	return invoke('worktree_remove', { request });
}

export async function getWorktree(id: string): Promise<WorktreeInfo> {
	return invoke<WorktreeInfo>('worktree_get', { id });
}

export async function setActiveWorktree(id: string | null): Promise<void> {
	return invoke('worktree_set_active', { id });
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
