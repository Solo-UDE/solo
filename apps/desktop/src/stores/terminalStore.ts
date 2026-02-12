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
	closeAll: () => void;
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

		closeAll: () =>
			set((state) => {
				state.terminals = new Map();
				state.activeTerminalId = null;
			}),
	})),
);
