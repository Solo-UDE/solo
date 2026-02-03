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

/** Read CSS custom properties and map to an xterm ITheme. */
function getThemeFromCSS(): Record<string, string> {
	const style = getComputedStyle(document.documentElement);
	const get = (name: string) => style.getPropertyValue(name).trim();

	return {
		background: get('--color-background') || '#1e1e2e',
		foreground: get('--color-foreground') || '#cdd6f4',
		cursor: get('--color-foreground') || '#cdd6f4',
		cursorAccent: get('--color-background') || '#1e1e2e',
		selectionBackground: get('--color-muted') || '#45475a',
	};
}

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
			theme: getThemeFromCSS(),
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

		// ResizeObserver to keep xterm fitted
		const observer = new ResizeObserver(() => {
			requestAnimationFrame(() => {
				if (!fitRef.current) return;
				fitRef.current.fit();
				const dims = fitRef.current.proposeDimensions();
				if (dims) {
					resizeTerminal(terminalId, dims.cols, dims.rows).catch((err) => {
						console.debug('Terminal resize failed (may be dead):', err);
					});
				}
			});
		});
		observer.observe(container);

		// Watch for theme changes (class mutations on <html> indicate dark/light switch)
		const themeObserver = new MutationObserver(() => {
			term.options.theme = getThemeFromCSS();
		});
		themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class', 'data-theme'],
		});

		return () => {
			themeObserver.disconnect();
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
