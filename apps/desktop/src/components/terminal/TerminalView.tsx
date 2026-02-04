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

const DARK_ANSI = {
	black:         '#3b3b3b',
	red:           '#ff5f56',
	green:         '#2ed573',
	yellow:        '#ffc107',
	blue:          '#61afef',
	magenta:       '#c678dd',
	cyan:          '#56d4dd',
	white:         '#d4d4d4',
	brightBlack:   '#6b6b6b',
	brightRed:     '#ff6e67',
	brightGreen:   '#5af78e',
	brightYellow:  '#ffd866',
	brightBlue:    '#6cb6ff',
	brightMagenta: '#d19aff',
	brightCyan:    '#7ee8e8',
	brightWhite:   '#f1f1f1',
};

const LIGHT_ANSI = {
	black:         '#383a42',
	red:           '#d32f2f',
	green:         '#388e3c',
	yellow:        '#c68a00',
	blue:          '#1976d2',
	magenta:       '#7b1fa2',
	cyan:          '#0097a7',
	white:         '#fafafa',
	brightBlack:   '#8e8e8e',
	brightRed:     '#e53935',
	brightGreen:   '#43a047',
	brightYellow:  '#f9a825',
	brightBlue:    '#42a5f5',
	brightMagenta: '#ab47bc',
	brightCyan:    '#26c6da',
	brightWhite:   '#ffffff',
};

let _hexCtx: CanvasRenderingContext2D | null = null;

function cssColorToHex(cssValue: string): string {
	if (!_hexCtx) _hexCtx = document.createElement('canvas').getContext('2d');
	if (!_hexCtx) return cssValue;
	_hexCtx.fillStyle = cssValue;
	return _hexCtx.fillStyle;
}

function getCssVarHex(name: string): string {
	const raw = getComputedStyle(document.documentElement)
		.getPropertyValue(name).trim();
	return raw ? cssColorToHex(raw) : '';
}

function isVibrancy(): boolean {
	return document.documentElement.hasAttribute('data-vibrancy');
}

function buildTerminalTheme(): Record<string, string> {
	const dark = document.documentElement.classList.contains('dark');
	const bg = getCssVarHex('--background');
	const fg = getCssVarHex('--foreground');
	const muted = getCssVarHex('--muted');

	return {
		background: isVibrancy() ? '#00000000' : bg,
		foreground: fg,
		cursor: fg,
		cursorAccent: bg,
		selectionBackground: muted,
		...(dark ? DARK_ANSI : LIGHT_ANSI),
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
			fontFamily: '"MesloLGS NF", "Hack Nerd Font", "FiraCode Nerd Font", "JetBrainsMono Nerd Font", ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Code", monospace',
			theme: buildTerminalTheme(),
			allowTransparency: isVibrancy(),
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

		// Follow light/dark theme changes
		const themeObserver = new MutationObserver(() => {
			term.options.theme = buildTerminalTheme();
		});
		themeObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['class'],
		});

		return () => {
			if (resizeTimer) clearTimeout(resizeTimer);
			observer.disconnect();
			themeObserver.disconnect();
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
