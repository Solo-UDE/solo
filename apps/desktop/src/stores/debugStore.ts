/**
 * Debug Store
 *
 * Manages debug/observability state for the agent bridge.
 * Receives structured debug events from the bridge IPC and provides
 * a filterable event log, tool timeline, and token usage tracking.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { AgentDebugEvent } from '../lib/tauri/agent';

// =============================================================================
// Types
// =============================================================================

export interface DebugEventEntry {
	id: number;
	sessionId: string;
	category: string;
	name: string;
	data: unknown;
	correlationId?: string;
	timestamp: string;
	durationMs?: number;
}

export interface ToolTimelineEntry {
	toolName: string;
	toolId: string;
	startTime: string;
	endTime?: string;
	durationMs?: number;
	status: 'running' | 'success' | 'error';
	correlationId?: string;
}

export interface TokenAccum {
	inputTokens: number;
	outputTokens: number;
	cacheReadInputTokens: number;
	cacheCreationInputTokens: number;
	turnCount: number;
	totalCostUsd: number;
}

export interface SDKStateSnapshot {
	model: string;
	thinkingEnabled: boolean;
	thinkingBudget: number;
	planMode: boolean;
	acceptMode: boolean;
	sessionMode: string;
}

// =============================================================================
// Store Interface
// =============================================================================

const MAX_EVENTS = 1000;
const MAX_TOOL_TIMELINE = 200;

interface DebugState {
	enabled: boolean;
	panelOpen: boolean;
	events: DebugEventEntry[];
	sdkState: SDKStateSnapshot;
	tokenUsage: {
		session: TokenAccum;
		turn: TokenAccum;
	};
	toolTimeline: ToolTimelineEntry[];
	filters: Set<string>;
	activeTab: 'events' | 'tools' | 'tokens' | 'raw';
}

interface DebugActions {
	setEnabled: (enabled: boolean) => void;
	togglePanel: () => void;
	setPanelOpen: (open: boolean) => void;
	addEvent: (event: AgentDebugEvent) => void;
	setFilter: (category: string, active: boolean) => void;
	clearEvents: () => void;
	setActiveTab: (tab: DebugState['activeTab']) => void;
}

let nextEventId = 0;

// =============================================================================
// Store
// =============================================================================

export const useDebugStore = create<DebugState & DebugActions>()(
	immer((set) => ({
		// State
		enabled: false,
		panelOpen: false,
		events: [],
		sdkState: {
			model: 'sonnet',
			thinkingEnabled: false,
			thinkingBudget: 0,
			planMode: false,
			acceptMode: false,
			sessionMode: 'agent',
		},
		tokenUsage: {
			session: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadInputTokens: 0,
				cacheCreationInputTokens: 0,
				turnCount: 0,
				totalCostUsd: 0,
			},
			turn: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadInputTokens: 0,
				cacheCreationInputTokens: 0,
				turnCount: 0,
				totalCostUsd: 0,
			},
		},
		toolTimeline: [],
		filters: new Set<string>(),
		activeTab: 'events',

		// Actions
		setEnabled: (enabled) => set((state) => { state.enabled = enabled; }),

		togglePanel: () => set((state) => {
			state.panelOpen = !state.panelOpen;
			if (state.panelOpen) state.enabled = true;
		}),

		setPanelOpen: (open) => set((state) => {
			state.panelOpen = open;
			if (open) state.enabled = true;
		}),

		addEvent: (rawEvent) => set((state) => {
			if (!state.enabled) return;

			const entry: DebugEventEntry = {
				id: nextEventId++,
				sessionId: rawEvent.sessionId,
				category: rawEvent.event.category,
				name: rawEvent.event.name,
				data: rawEvent.event.data,
				correlationId: rawEvent.event.correlationId,
				timestamp: rawEvent.event.timestamp,
				durationMs: rawEvent.event.durationMs,
			};

			// Add to ring buffer
			state.events.push(entry);
			if (state.events.length > MAX_EVENTS) {
				state.events = state.events.slice(-MAX_EVENTS);
			}

			// Process special event types

			// Tool timeline tracking
			if (entry.category === 'tool' && entry.name === 'tool_use_start') {
				const data = entry.data as { toolName?: string; toolId?: string };
				if (data.toolName && data.toolId) {
					state.toolTimeline.push({
						toolName: data.toolName,
						toolId: data.toolId,
						startTime: entry.timestamp,
						status: 'running',
						correlationId: entry.correlationId,
					});
					if (state.toolTimeline.length > MAX_TOOL_TIMELINE) {
						state.toolTimeline = state.toolTimeline.slice(-MAX_TOOL_TIMELINE);
					}
				}
			} else if (entry.category === 'tool' && entry.name === 'tool_use_end') {
				const data = entry.data as { toolId?: string; isError?: boolean; durationMs?: number };
				if (data.toolId) {
					const idx = state.toolTimeline.findIndex(
						(t) => t.toolId === data.toolId && t.status === 'running'
					);
					if (idx >= 0) {
						state.toolTimeline[idx].endTime = entry.timestamp;
						state.toolTimeline[idx].durationMs = data.durationMs;
						state.toolTimeline[idx].status = data.isError ? 'error' : 'success';
					}
				}
			}

			// Token usage tracking
			if (entry.category === 'token' && entry.name === 'turn_tokens') {
				const data = entry.data as {
					turn?: TokenAccum;
					cumulative?: TokenAccum;
				};
				if (data.turn) {
					state.tokenUsage.turn = data.turn;
				}
				if (data.cumulative) {
					state.tokenUsage.session = data.cumulative;
				}
			}

			// SDK state tracking
			if (entry.category === 'session' && entry.name === 'session_creating') {
				const data = entry.data as Record<string, unknown>;
				state.sdkState = {
					model: (data.model as string) ?? state.sdkState.model,
					thinkingEnabled: (data.thinkingEnabled as boolean) ?? state.sdkState.thinkingEnabled,
					thinkingBudget: (data.maxThinkingTokens as number) ?? state.sdkState.thinkingBudget,
					planMode: (data.planEnabled as boolean) ?? state.sdkState.planMode,
					acceptMode: (data.acceptEnabled as boolean) ?? state.sdkState.acceptMode,
					sessionMode: (data.sessionMode as string) ?? state.sdkState.sessionMode,
				};
			}
		}),

		setFilter: (category, active) => set((state) => {
			if (active) {
				state.filters.add(category);
			} else {
				state.filters.delete(category);
			}
		}),

		clearEvents: () => set((state) => {
			state.events = [];
			state.toolTimeline = [];
			nextEventId = 0;
		}),

		setActiveTab: (tab) => set((state) => { state.activeTab = tab; }),
	}))
);
