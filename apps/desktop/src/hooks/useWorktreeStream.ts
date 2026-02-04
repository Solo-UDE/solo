/**
 * Singleton worktree event listener
 *
 * Listens for worktree backend events and dispatches to the worktree store.
 * Follows the same pattern as useAgentStream.
 */

import { useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useWorktreeStore } from '../stores/worktreeStore';
import type { WorktreeInfo } from '../bindings';

interface WorktreeEventPayload {
	type: string;
	payload: {
		worktree_id: string;
		message?: string;
		info?: WorktreeInfo;
		error?: string;
	};
}

export function useWorktreeStream(): void {
	const handleProgress = useWorktreeStore((s) => s.handleWorktreeProgress);
	const handleReady = useWorktreeStore((s) => s.handleWorktreeReady);
	const handleError = useWorktreeStore((s) => s.handleWorktreeError);
	const handleRemoved = useWorktreeStore((s) => s.handleWorktreeRemoved);

	const cleanupRef = useRef<UnlistenFn | null>(null);

	useEffect(() => {
		listen<WorktreeEventPayload>('backend-event', (event) => {
			const payload = event.payload;

			switch (payload.type) {
				case 'worktree:progress':
					handleProgress(payload.payload.worktree_id, payload.payload.message ?? '');
					break;
				case 'worktree:ready':
					if (payload.payload.info) {
						handleReady(payload.payload.worktree_id, payload.payload.info);
					}
					break;
				case 'worktree:error':
					handleError(payload.payload.worktree_id, payload.payload.error ?? 'Unknown error');
					break;
				case 'worktree:removed':
					handleRemoved(payload.payload.worktree_id);
					break;
			}
		}).then((unlisten) => {
			cleanupRef.current = unlisten;
		}).catch((error) => {
			console.error('Failed to listen to worktree events:', error);
		});

		return () => {
			if (cleanupRef.current) {
				cleanupRef.current();
				cleanupRef.current = null;
			}
		};
	}, [handleProgress, handleReady, handleError, handleRemoved]);
}
