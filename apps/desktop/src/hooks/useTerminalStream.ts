/**
 * Singleton terminal stream listener
 *
 * Module-level callback maps + one global Tauri listener that dispatches
 * terminal:data and terminal:exit events to per-terminal callbacks.
 */

import { useEffect } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { BackendEvent } from '../bindings';

type DataCallback = (data: string) => void;
type ExitCallback = (code: number | null) => void;

const dataCallbacks = new Map<string, DataCallback>();
const exitCallbacks = new Map<string, ExitCallback>();

/**
 * Register per-terminal callbacks. Returns a cleanup function.
 */
export function registerTerminalCallbacks(
	id: string,
	onData: DataCallback,
	onExit: ExitCallback,
): () => void {
	dataCallbacks.set(id, onData);
	exitCallbacks.set(id, onExit);
	return () => {
		dataCallbacks.delete(id);
		exitCallbacks.delete(id);
	};
}

/**
 * Sets up a single global listener for terminal backend events.
 * Mount once at the app root (App.tsx).
 *
 * Uses closure-scoped cancellation so each StrictMode invocation
 * independently tracks whether its listener should stay alive.
 */
export function useTerminalStream(): void {
	useEffect(() => {
		let cancelled = false;
		let unlisten: UnlistenFn | null = null;

		listen<BackendEvent>('terminal-event', (event) => {
			const payload = event.payload;

			if (payload.type === 'terminal:data') {
				const cb = dataCallbacks.get(payload.payload.id);
				cb?.(payload.payload.data);
			} else if (payload.type === 'terminal:exit') {
				const cb = exitCallbacks.get(payload.payload.id);
				cb?.(payload.payload.code);
			}
		})
			.then((fn) => {
				if (cancelled) {
					fn();
				} else {
					unlisten = fn;
				}
			})
			.catch((err) => {
				console.error('Failed to listen to terminal events:', err);
			});

		return () => {
			cancelled = true;
			unlisten?.();
		};
	}, []);
}
