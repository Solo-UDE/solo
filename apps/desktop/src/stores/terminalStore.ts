/**
 * Terminal Zustand Store
 * Manages terminal instance metadata (not xterm.js objects).
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { enableMapSet } from 'immer';

enableMapSet();

export interface TerminalInstance {
	id: string;
	title: string;
	cwd?: string;
	isAlive: boolean;
}

interface TerminalState {
	terminals: Map<string, TerminalInstance>;
	activeTerminalId: string | null;

	addTerminal: (id: string, cwd?: string, shell?: string) => void;
	removeTerminal: (id: string) => void;
	setActiveTerminal: (id: string | null) => void;
	markExited: (id: string) => void;
	renameTerminal: (id: string, title: string) => void;
	/** Cycle to the next or previous terminal tab */
	cycleTerminal: (direction: 'next' | 'prev') => void;
}

/** Registry for imperative terminal actions (clear, find) keyed by terminal ID */
type TerminalAction = () => void;
const clearCallbacks = new Map<string, TerminalAction>();
const findCallbacks = new Map<string, TerminalAction>();

export function registerTerminalActions(
	id: string,
	onClear: TerminalAction,
	onFind: TerminalAction,
): () => void {
	clearCallbacks.set(id, onClear);
	findCallbacks.set(id, onFind);
	return () => {
		clearCallbacks.delete(id);
		findCallbacks.delete(id);
	};
}

export function clearActiveTerminal(): void {
	const { activeTerminalId } = useTerminalStore.getState();
	if (activeTerminalId) clearCallbacks.get(activeTerminalId)?.();
}

export function findInActiveTerminal(): void {
	const { activeTerminalId } = useTerminalStore.getState();
	if (activeTerminalId) findCallbacks.get(activeTerminalId)?.();
}

export const useTerminalStore = create<TerminalState>()(
	immer((set) => ({
		terminals: new Map(),
		activeTerminalId: null,

		addTerminal: (id, cwd, shell) =>
			set((state) => {
				state.terminals.set(id, {
					id,
					title: shell ?? 'Terminal',
					cwd,
					isAlive: true,
				});
				state.activeTerminalId = id;
			}),

		removeTerminal: (id) =>
			set((state) => {
				state.terminals.delete(id);
				if (state.activeTerminalId === id) {
					// Pick next terminal or null
					const remaining = [...state.terminals.keys()];
					state.activeTerminalId = remaining[0] ?? null;
				}
			}),

		setActiveTerminal: (id) =>
			set((state) => {
				state.activeTerminalId = id;
			}),

		markExited: (id) =>
			set((state) => {
				const terminal = state.terminals.get(id);
				if (terminal) {
					terminal.isAlive = false;
					terminal.title = `${terminal.title} (exited)`;
				}
			}),

		renameTerminal: (id, title) =>
			set((state) => {
				const terminal = state.terminals.get(id);
				if (terminal) {
					terminal.title = title;
				}
			}),

		cycleTerminal: (direction) =>
			set((state) => {
				const ids = [...state.terminals.keys()];
				if (ids.length < 2) return;
				const idx = state.activeTerminalId ? ids.indexOf(state.activeTerminalId) : 0;
				const next = direction === 'next'
					? (idx + 1) % ids.length
					: (idx - 1 + ids.length) % ids.length;
				state.activeTerminalId = ids[next];
			}),
	})),
);
