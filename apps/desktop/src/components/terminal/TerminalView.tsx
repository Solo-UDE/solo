/**
 * TerminalView — xterm.js integration component
 *
 * Creates an xterm Terminal instance, wires PTY I/O through Tauri IPC,
 * and handles resize via ResizeObserver + FitAddon.
 */

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { SearchAddon } from '@xterm/addon-search';
import { MagnifyingGlass, X, ArrowUp, ArrowDown } from '@phosphor-icons/react';
import '@xterm/xterm/css/xterm.css';

import { writeTerminal, resizeTerminal } from '@/lib/tauri/terminal';
import { registerTerminalCallbacks } from '@/hooks/useTerminalStream';
import { registerTerminalActions } from '@/stores/terminalStore';

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
	const searchRef = useRef<SearchAddon | null>(null);
	const onExitRef = useRef(onExit);
	const searchInputRef = useRef<HTMLInputElement>(null);

	const [searchOpen, setSearchOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState('');

	const ensureSearchAddon = useCallback(async () => {
		if (!searchRef.current && termRef.current) {
			const { SearchAddon } = await import('@xterm/addon-search');
			const addon = new SearchAddon();
			termRef.current.loadAddon(addon);
			searchRef.current = addon;
		}
		return searchRef.current;
	}, []);

	const openSearch = useCallback(() => {
		setSearchOpen(true);
		ensureSearchAddon();
		requestAnimationFrame(() => searchInputRef.current?.focus());
	}, [ensureSearchAddon]);

	const closeSearch = useCallback(() => {
		setSearchOpen(false);
		setSearchQuery('');
		searchRef.current?.clearDecorations();
		termRef.current?.focus();
	}, []);

	const handleSearchChange = useCallback((value: string) => {
		setSearchQuery(value);
		if (value) {
			ensureSearchAddon().then((s) => s?.findNext(value));
		} else {
			searchRef.current?.clearDecorations();
		}
	}, [ensureSearchAddon]);

	const handleSearchNext = useCallback(() => {
		if (searchQuery) searchRef.current?.findNext(searchQuery);
	}, [searchQuery]);

	const handleSearchPrev = useCallback(() => {
		if (searchQuery) searchRef.current?.findPrevious(searchQuery);
	}, [searchQuery]);

	// Keep the onExit ref current so the registered callback never goes stale
	useEffect(() => {
		onExitRef.current = onExit;
	}, [onExit]);

	// Create terminal on mount
	useLayoutEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const DEV = import.meta.env.DEV;
		if (DEV) performance.mark('terminal:mount-start');

		if (DEV) performance.mark('terminal:addon-create-start');
		const fitAddon = new FitAddon();
		if (DEV) performance.mark('terminal:addon-create-end');

		if (DEV) performance.mark('terminal:instance-start');
		const term = new Terminal({
			cursorBlink: true,
			cursorStyle: 'bar',
			cursorWidth: 2,
			cursorInactiveStyle: 'outline',
			fontSize: 13,
			fontFamily: '"MesloLGS NF", "Hack Nerd Font", "FiraCode Nerd Font", "JetBrainsMono Nerd Font", ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Code", monospace',
			theme: buildTerminalTheme(),
			allowTransparency: isVibrancy(),
			allowProposedApi: true,
			scrollback: 5000,
		});
		if (DEV) performance.mark('terminal:instance-end');

		if (DEV) performance.mark('terminal:addon-load-start');
		term.loadAddon(fitAddon);
		if (DEV) performance.mark('terminal:addon-load-end');

		if (DEV) performance.mark('terminal:dom-open-start');
		term.open(container);
		if (DEV) performance.mark('terminal:dom-open-end');

		// Defer WebLinksAddon — not needed at mount time
		const scheduleIdle = globalThis.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 150));
		scheduleIdle(() => {
			import('@xterm/addon-web-links').then(({ WebLinksAddon }) => {
				term.loadAddon(new WebLinksAddon());
			});
		});

		termRef.current = term;
		fitRef.current = fitAddon;

		// Fit after open (needs a frame for layout)
		requestAnimationFrame(() => {
			if (DEV) performance.mark('terminal:fit-start');
			fitAddon.fit();
			if (DEV) {
				performance.mark('terminal:fit-end');
				performance.measure('terminal:addon-create', 'terminal:addon-create-start', 'terminal:addon-create-end');
				performance.measure('terminal:instance', 'terminal:instance-start', 'terminal:instance-end');
				performance.measure('terminal:addon-load', 'terminal:addon-load-start', 'terminal:addon-load-end');
				performance.measure('terminal:dom-open', 'terminal:dom-open-start', 'terminal:dom-open-end');
				performance.measure('terminal:fit', 'terminal:fit-start', 'terminal:fit-end');
				performance.measure('terminal:total-mount', 'terminal:mount-start', 'terminal:fit-end');
				const entries = performance.getEntriesByType('measure')
					.filter((e) => e.name.startsWith('terminal:'));
				console.table(entries.map((e) => ({ name: e.name, ms: +e.duration.toFixed(2) })));
			}
		});

		// Forward user keystrokes to PTY
		const dataDisposable = term.onData((data) => {
			writeTerminal(terminalId, data).catch((err) => {
				console.error('Failed to write to terminal:', err);
			});
		});

		// Register imperative actions (clear, find)
		const unregisterActions = registerTerminalActions(
			terminalId,
			() => term.clear(),
			() => openSearch(),
		);

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
			unregisterActions();
			term.dispose();
			termRef.current = null;
			fitRef.current = null;
			searchRef.current = null; // may be null if search was never opened
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
		<div className="h-full w-full relative">
			{/* Search bar overlay */}
			{searchOpen && (
				<div className="absolute top-1 right-2 z-10 flex items-center gap-1 bg-sidebar border border-border/50 rounded-md px-2 py-1 shadow-sm">
					<MagnifyingGlass className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
					<input
						ref={searchInputRef}
						type="text"
						value={searchQuery}
						onChange={(e) => handleSearchChange(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter') {
								e.shiftKey ? handleSearchPrev() : handleSearchNext();
							} else if (e.key === 'Escape') {
								closeSearch();
							}
						}}
						className="bg-transparent text-xs text-foreground outline-none w-40 placeholder:text-muted-foreground/50"
						placeholder="Find..."
					/>
					<button
						onClick={handleSearchPrev}
						className="p-0.5 rounded hover:bg-muted-foreground/20 text-muted-foreground"
						aria-label="Previous match"
					>
						<ArrowUp className="w-3 h-3" />
					</button>
					<button
						onClick={handleSearchNext}
						className="p-0.5 rounded hover:bg-muted-foreground/20 text-muted-foreground"
						aria-label="Next match"
					>
						<ArrowDown className="w-3 h-3" />
					</button>
					<button
						onClick={closeSearch}
						className="p-0.5 rounded hover:bg-muted-foreground/20 text-muted-foreground"
						aria-label="Close search"
					>
						<X className="w-3 h-3" />
					</button>
				</div>
			)}
			<div
				ref={containerRef}
				className="h-full w-full"
				style={{ padding: 4 }}
			/>
		</div>
	);
}
