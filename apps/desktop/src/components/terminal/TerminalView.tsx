/**
 * TerminalView — xterm.js integration component
 *
 * Creates an xterm Terminal instance, wires PTY I/O through Tauri IPC,
 * and handles resize via ResizeObserver + FitAddon.
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

import { writeTerminal, resizeTerminal } from '@/lib/tauri/terminal';
import { registerTerminalCallbacks } from '@/hooks/useTerminalStream';

interface TerminalViewProps {
	terminalId: string;
	isActive: boolean;
	onExit?: (code: number | null) => void;
}

/** Catppuccin Mocha — always-dark terminal palette (decoupled from app theme). */
const TERMINAL_THEME = {
	background: '#1e1e2e',
	foreground: '#cdd6f4',
	cursor: '#cdd6f4',
	cursorAccent: '#1e1e2e',
	selectionBackground: '#45475a',
	black: '#45475a',
	red: '#f38ba8',
	green: '#a6e3a1',
	yellow: '#f9e2af',
	blue: '#89b4fa',
	magenta: '#f5c2e7',
	cyan: '#94e2d5',
	white: '#cdd6f4',
	brightBlack: '#585b70',
	brightRed: '#f38ba8',
	brightGreen: '#a6e3a1',
	brightYellow: '#f9e2af',
	brightBlue: '#89b4fa',
	brightMagenta: '#f5c2e7',
	brightCyan: '#94e2d5',
	brightWhite: '#f5f5f5',
};

export function TerminalView({ terminalId, isActive, onExit }: TerminalViewProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const termRef = useRef<Terminal | null>(null);
	const fitRef = useRef<FitAddon | null>(null);
	const onExitRef = useRef(onExit);

	// Keep the onExit ref current so the registered callback never goes stale
	useEffect(() => {
		onExitRef.current = onExit;
	}, [onExit]);

	// Create terminal on mount
	useLayoutEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const fitAddon = new FitAddon();
		const webLinksAddon = new WebLinksAddon();

		const term = new Terminal({
			cursorBlink: true,
			fontSize: 13,
			fontFamily: 'ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Code", monospace',
			theme: TERMINAL_THEME,
			allowProposedApi: true,
			scrollback: 5000,
		});

		term.loadAddon(fitAddon);
		term.loadAddon(webLinksAddon);
		term.open(container);

		termRef.current = term;
		fitRef.current = fitAddon;

		// Fit after open (needs a frame for layout)
		requestAnimationFrame(() => {
			fitAddon.fit();
		});

		// Forward user keystrokes to PTY
		const dataDisposable = term.onData((data) => {
			writeTerminal(terminalId, data).catch((err) => {
				console.error('Failed to write to terminal:', err);
			});
		});

		// Register for backend PTY output (call through ref to avoid stale closure)
		const unregister = registerTerminalCallbacks(
			terminalId,
			(data) => term.write(data),
			(code) => onExitRef.current?.(code),
		);

		// ResizeObserver to keep xterm fitted.
		// Debounced to avoid flicker during CSS transitions (e.g. sidebar resize).
		let resizeTimer: ReturnType<typeof setTimeout> | null = null;

		const observer = new ResizeObserver(() => {
			if (resizeTimer) clearTimeout(resizeTimer);
			resizeTimer = setTimeout(() => {
				if (!fitRef.current) return;
				fitRef.current.fit();
				const dims = fitRef.current.proposeDimensions();
				if (dims) {
					resizeTerminal(terminalId, dims.cols, dims.rows).catch((err) => {
						console.debug('Terminal resize failed (may be dead):', err);
					});
				}
			}, 80);
		});
		observer.observe(container);

		return () => {
			if (resizeTimer) clearTimeout(resizeTimer);
			observer.disconnect();
			dataDisposable.dispose();
			unregister();
			term.dispose();
			termRef.current = null;
			fitRef.current = null;
		};
	}, [terminalId]); // eslint-disable-line react-hooks/exhaustive-deps

	// Re-fit when the tab becomes visible
	useEffect(() => {
		if (isActive && fitRef.current) {
			requestAnimationFrame(() => {
				fitRef.current?.fit();
			});
		}
	}, [isActive]);

	return (
		<div
			ref={containerRef}
			className="h-full w-full"
			style={{ padding: 4 }}
		/>
	);
}
