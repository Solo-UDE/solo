/**
 * Debug Panel — collapsible bottom panel with tabs for debug observability.
 *
 * Tabs: Events | Tools | Tokens | Raw
 * Shows SDK state indicator bar at the top.
 * Toggle via keyboard shortcut (Ctrl+Shift+D) or debug icon.
 */

import { useEffect, useCallback, type FC } from 'react';
import { Bug, X } from '@phosphor-icons/react';
import { useDebugStore } from '../../../stores/debugStore';
import { DebugEventLog } from './DebugEventLog';
import { ToolTimeline } from './ToolTimeline';
import { TokenUsageDisplay } from './TokenUsageDisplay';
import { SDKStateIndicator } from './SDKStateIndicator';

const TABS = [
	{ id: 'events' as const, label: 'Events' },
	{ id: 'tools' as const, label: 'Tools' },
	{ id: 'tokens' as const, label: 'Tokens' },
	{ id: 'raw' as const, label: 'Raw' },
];

const RawEventView: FC = () => {
	const events = useDebugStore((s) => s.events);
	const lastEvents = events.slice(-20).reverse();

	return (
		<div className="flex-1 overflow-y-auto p-2">
			<pre className="text-[10px] font-mono text-muted-foreground/70 whitespace-pre-wrap">
				{lastEvents.map((e) => JSON.stringify(e, null, 2)).join('\n---\n')}
			</pre>
		</div>
	);
};

export const DebugPanel: FC = () => {
	const panelOpen = useDebugStore((s) => s.panelOpen);
	const togglePanel = useDebugStore((s) => s.togglePanel);
	const setPanelOpen = useDebugStore((s) => s.setPanelOpen);
	const activeTab = useDebugStore((s) => s.activeTab);
	const setActiveTab = useDebugStore((s) => s.setActiveTab);
	const eventCount = useDebugStore((s) => s.events.length);

	// Keyboard shortcut: Ctrl+Shift+D
	const handleKeyDown = useCallback((e: KeyboardEvent) => {
		if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
			e.preventDefault();
			togglePanel();
		}
	}, [togglePanel]);

	useEffect(() => {
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [handleKeyDown]);

	if (!panelOpen) return null;

	return (
		<div className="border-t border-border/30 bg-card/95 backdrop-blur-sm flex flex-col"
			style={{ height: '240px' }}
		>
			{/* Header */}
			<div className="flex items-center justify-between px-2 py-1 border-b border-border/20">
				<div className="flex items-center gap-2">
					<Bug className="w-3.5 h-3.5 text-muted-foreground/60" />
					<span className="text-[11px] font-medium text-muted-foreground">Debug</span>
					<span className="text-[10px] text-muted-foreground/40">{eventCount}</span>
				</div>

				{/* Tabs */}
				<div className="flex items-center gap-0.5">
					{TABS.map((tab) => (
						<button
							key={tab.id}
							onClick={() => setActiveTab(tab.id)}
							className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
								activeTab === tab.id
									? 'bg-muted/60 text-foreground'
									: 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/30'
							}`}
						>
							{tab.label}
						</button>
					))}
				</div>

				<button
					onClick={() => setPanelOpen(false)}
					className="p-1 rounded hover:bg-muted/40 transition-colors"
				>
					<X className="w-3 h-3 text-muted-foreground/60" />
				</button>
			</div>

			{/* SDK State bar */}
			<SDKStateIndicator />

			{/* Tab content */}
			<div className="flex-1 overflow-hidden">
				{activeTab === 'events' && <DebugEventLog />}
				{activeTab === 'tools' && <ToolTimeline />}
				{activeTab === 'tokens' && <TokenUsageDisplay />}
				{activeTab === 'raw' && <RawEventView />}
			</div>
		</div>
	);
};

/**
 * Small toggle button for the debug panel.
 * Place in the agent window toolbar.
 */
export const DebugToggleButton: FC = () => {
	const togglePanel = useDebugStore((s) => s.togglePanel);
	const panelOpen = useDebugStore((s) => s.panelOpen);
	const eventCount = useDebugStore((s) => s.events.length);

	return (
		<button
			onClick={togglePanel}
			className={`p-1.5 rounded-lg transition-colors duration-150 ${
				panelOpen
					? 'bg-primary/10 text-primary'
					: 'hover:bg-muted/60 text-muted-foreground'
			}`}
			title={`Debug panel (${eventCount} events) — Ctrl+Shift+D`}
		>
			<Bug className="w-4 h-4" />
		</button>
	);
};
