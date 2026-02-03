/**
 * TerminalPanel — Panel wrapper for TerminalView
 *
 * Integrates with the panel system: handles lifecycle, title updates,
 * and cleanup of the backend PTY process on close.
 */

import { useEffect, useRef } from 'react';
import { TerminalView } from '@/components/terminal/TerminalView';
import { useTerminalStore } from '@/stores/terminalStore';
import { killTerminal } from '@/lib/tauri/terminal';
import type { PanelProps } from '@/lib/panels/types';

interface TerminalPanelData {
	terminalId?: string;
}

export function TerminalPanel({
	data,
	isActive,
	onTitleChange,
}: PanelProps<TerminalPanelData>) {
	const terminalId = data?.terminalId;
	const killedRef = useRef(false);
	const pendingKillRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Sync title from store
	useEffect(() => {
		if (!terminalId) return;

		const update = () => {
			const terminal = useTerminalStore.getState().terminals.get(terminalId);
			onTitleChange(terminal?.title ?? 'Terminal');
		};

		update();
		return useTerminalStore.subscribe(update);
	}, [terminalId, onTitleChange]);

	// Kill backend process on unmount (deferred to survive StrictMode double-mount).
	// StrictMode unmounts then immediately remounts — the remount cancels the pending kill.
	useEffect(() => {
		if (pendingKillRef.current !== null) {
			clearTimeout(pendingKillRef.current);
			pendingKillRef.current = null;
		}

		return () => {
			if (terminalId && !killedRef.current) {
				pendingKillRef.current = setTimeout(() => {
					killedRef.current = true;
					killTerminal(terminalId).catch(() => {
						// Terminal may already be dead
					});
					useTerminalStore.getState().removeTerminal(terminalId);
				}, 50);
			}
		};
	}, [terminalId]);

	if (!terminalId) {
		return (
			<div className="flex items-center justify-center h-full text-muted-foreground">
				No terminal ID
			</div>
		);
	}

	const handleExit = () => {
		useTerminalStore.getState().markExited(terminalId);
	};

	return (
		<TerminalView
			terminalId={terminalId}
			isActive={isActive}
			onExit={handleExit}
		/>
	);
}
