/**
 * Singleton worktree event listener
 *
 * Listens for worktree backend events and dispatches to the worktree store.
 * Follows the same pattern as useGitStream: accesses store handlers via
 * getState() inside the effect to avoid stale closures.
 * Retries with exponential backoff if the listener fails to attach.
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
		command?: string;
		output?: string;
		is_error?: boolean;
		is_complete?: boolean;
	};
}

const MAX_RETRIES = 5;

export function useWorktreeStream(): void {
	const cleanupRef = useRef<UnlistenFn | null>(null);
	const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		let cancelled = false;

		const attach = (attempt: number) => {
			if (cancelled) return;

			listen<WorktreeEventPayload>('backend-event', (event) => {
				const payload = event.payload;
				// Access handlers via getState() to avoid stale closures
				const store = useWorktreeStore.getState();

				switch (payload.type) {
					case 'worktree:progress':
						store.handleWorktreeProgress(payload.payload.worktree_id, payload.payload.message ?? '');
						break;
					case 'worktree:ready':
						if (payload.payload.info) {
							store.handleWorktreeReady(payload.payload.worktree_id, payload.payload.info);
						}
						break;
					case 'worktree:error':
						store.handleWorktreeError(
							payload.payload.worktree_id,
							payload.payload.error ?? 'Unknown error',
						);
						break;
					case 'worktree:removed':
						store.handleWorktreeRemoved(payload.payload.worktree_id);
						break;
					case 'worktree:setup_progress':
						store.handleSetupProgress(
							payload.payload.worktree_id,
							payload.payload.output ?? '',
							payload.payload.is_complete ?? false,
						);
						break;
				}
			})
				.then((unlisten) => {
					cleanupRef.current = unlisten;
				})
				.catch((error) => {
					console.error(
						`Failed to listen to worktree events (attempt ${attempt + 1}):`,
						error,
					);
					if (!cancelled && attempt < MAX_RETRIES) {
						const delay = Math.min(1000 * 2 ** attempt, 16000);
						retryTimerRef.current = setTimeout(() => attach(attempt + 1), delay);
					}
				});
		};

		attach(0);

		return () => {
			cancelled = true;
			if (retryTimerRef.current) {
				clearTimeout(retryTimerRef.current);
				retryTimerRef.current = null;
			}
			if (cleanupRef.current) {
				cleanupRef.current();
				cleanupRef.current = null;
			}
		};
	}, []);
}
