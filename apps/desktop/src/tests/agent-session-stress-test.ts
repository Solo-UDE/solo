/**
 * Agent Session Stress Test (Mosaic)
 *
 * Exercises the full agent session pipeline from browser DevTools:
 * - Session creation and initialization
 * - Text streaming (text chunks → result)
 * - Thinking mode toggle + thinking block verification
 * - Planning mode toggle + store sync
 * - Accept mode toggle + auto-approval flow
 * - Tool execution with manual permission approval
 * - Mid-stream interrupt
 * - Rapid mode cycling (stress test toggles)
 *
 * Test sequence:
 *   1. Create session + verify session_init
 *   2. Send simple message + verify streaming → complete
 *   3. Toggle thinking ON → send → verify thinking blocks
 *   4. Toggle thinking OFF → send → verify no new thinking
 *   5. Toggle planning mode ON/OFF → verify store state
 *   6. Toggle accept ON → send tool-trigger → verify auto-approve
 *   7. Toggle accept OFF → send tool-trigger → wait for permission → approve
 *   8. Send long prompt → interrupt mid-stream → verify clean stop
 *   9. Rapid mode cycling (5 rounds) → verify no store corruption
 *
 * Usage (from browser DevTools console):
 *   window.__debug.runAgentStressTest()
 *   window.__debug.runAgentStressTest({ operationTimeout: 180000 })
 *
 * Prerequisites:
 * - App must be running with a valid API key configured
 * - At least one provider active (Claude)
 */

import { useAgentStore } from '../stores/agentStore';
import type {
	Message,
	AgentSession,
	SessionStreamState,
	ContentBlock,
} from '../stores/agentStore';

// ── Types ──────────────────────────────────────────────────────────────

export interface TestConfig {
	/** Delay between sequential actions (ms). Default: 500 */
	delayBetweenActions?: number;
	/** Timeout for async operations (ms). Default: 120000 */
	operationTimeout?: number;
	/** Timeout for streaming start detection (ms). Default: 30000 */
	streamingStartTimeout?: number;
	/** Timeout for session creation (ms). Default: 15000 */
	createTimeout?: number;
	/** Delay after mode toggle (ms). Default: 1000 */
	delayAfterModeChange?: number;
	/** Number of rapid-cycle rounds. Default: 5 */
	rapidCycleRounds?: number;
}

interface StepResult {
	step: string;
	durationMs: number;
	success: boolean;
	details?: string;
	error?: string;
}

interface RecordedEvent {
	relativeMs: number;
	source: string;
	change: string;
}

// ── Global tracking for cleanup across runs ───────────────────────────

/** Session IDs created by previous stress test runs (survives across calls) */
const _previousTestSessionIds: string[] = [];

// ── Logging ────────────────────────────────────────────────────────────

const PREFIX = '[AgentStressTest]';
const log = (msg: string): void => console.warn(PREFIX + ' ' + msg);

// ── Helpers ────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Store Access ───────────────────────────────────────────────────────

function getStore() {
	return useAgentStore.getState();
}

function getSession(sessionId: string): AgentSession | undefined {
	return getStore().sessions.get(sessionId);
}

function getMessages(sessionId: string): Message[] {
	return getStore().messages.get(sessionId) ?? [];
}

function getStreamState(sessionId: string): SessionStreamState | undefined {
	return getStore().sessionStreaming.get(sessionId);
}

function getAssistantMessages(sessionId: string): Message[] {
	return getMessages(sessionId).filter((m) => m.role === 'assistant');
}

function getLastAssistantMessage(sessionId: string): Message | undefined {
	const msgs = getAssistantMessages(sessionId);
	return msgs[msgs.length - 1];
}

function getPlanMode(sessionId: string): boolean {
	return getStore().planModeActive.get(sessionId) ?? false;
}

function getAcceptMode(sessionId: string): boolean {
	return getStore().acceptModeActive.get(sessionId) ?? false;
}

function getPendingPermissions(): Map<string, unknown> {
	return getStore().pendingPermissions;
}

// ── Wait Primitives ────────────────────────────────────────────────────

function waitForStoreCondition<T>(
	selector: () => T,
	predicate: (val: T) => boolean,
	timeout: number,
	label: string,
): Promise<void> {
	return new Promise((resolve, reject) => {
		// Check immediately
		if (predicate(selector())) {
			resolve();
			return;
		}

		const timer = setTimeout(() => {
			unsub();
			const current = selector();
			reject(
				new Error(
					'Timeout (' +
					String(timeout) +
					'ms) waiting for: ' +
					label +
					'. Current value: ' +
					JSON.stringify(current, (_k, v) => {
						if (v instanceof Map) return Object.fromEntries(v);
						if (v instanceof Set) return [...v];
						return v;
					}),
				),
			);
		}, timeout);

		const unsub = useAgentStore.subscribe(() => {
			if (predicate(selector())) {
				clearTimeout(timer);
				unsub();
				resolve();
			}
		});
	});
}

function waitForSessionActive(sessionId: string, timeout: number): Promise<void> {
	return waitForStoreCondition(
		() => getSession(sessionId),
		(s) => s?.connectionState === 'active',
		timeout,
		'session ' + sessionId.slice(0, 12) + ' to become active',
	);
}

function waitForStreamingComplete(sessionId: string, timeout: number): Promise<void> {
	return waitForStoreCondition(
		() => getStreamState(sessionId),
		(s) => s !== undefined && !s.isStreaming,
		timeout,
		'streaming to complete for session ' + sessionId.slice(0, 12),
	);
}

function waitForStreamingStarted(sessionId: string, timeout: number): Promise<void> {
	return waitForStoreCondition(
		() => getStreamState(sessionId),
		(s) => s !== undefined && s.isStreaming,
		timeout,
		'streaming to start for session ' + sessionId.slice(0, 12),
	);
}

function waitForPermissionRequest(timeout: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const existing = getPendingPermissions();
		if (existing.size > 0) {
			resolve([...existing.keys()][0]);
			return;
		}

		const timer = setTimeout(() => {
			unsub();
			reject(new Error('Timeout (' + String(timeout) + 'ms) waiting for permission request'));
		}, timeout);

		const unsub = useAgentStore.subscribe(() => {
			const pending = getPendingPermissions();
			if (pending.size > 0) {
				clearTimeout(timer);
				unsub();
				resolve([...pending.keys()][0]);
			}
		});
	});
}

function waitForResultMessage(
	sessionId: string,
	assistantCountBefore: number,
	timeout: number,
): Promise<void> {
	return waitForStoreCondition(
		() => getAssistantMessages(sessionId),
		(msgs) => {
			if (msgs.length <= assistantCountBefore) return false;
			const latest = msgs[msgs.length - 1];
			return !latest.isStreaming;
		},
		timeout,
		'new completed assistant message (had ' + String(assistantCountBefore) + ')',
	);
}

// ── Assertion Helpers ──────────────────────────────────────────────────

function assertEq(actual: unknown, expected: unknown, label: string): void {
	if (actual !== expected) {
		throw new Error(label + ': expected ' + String(expected) + ', got ' + String(actual));
	}
}

function assertGte(actual: number, expected: number, label: string): void {
	if (actual < expected) {
		throw new Error(label + ': expected >= ' + String(expected) + ', got ' + String(actual));
	}
}

function assertTrue(condition: boolean, label: string): void {
	if (!condition) {
		throw new Error(label + ': expected true, got false');
	}
}

function assertFalse(condition: boolean, label: string): void {
	if (condition) {
		throw new Error(label + ': expected false, got true');
	}
}

function assertHasBlock(blocks: ContentBlock[], type: string, label: string): void {
	const found = blocks.some((b) => b.type === type);
	if (!found) {
		const types = blocks.map((b) => b.type).join(', ');
		throw new Error(label + ': no block of type "' + type + '" found in [' + types + ']');
	}
}

// ── Step Runner ────────────────────────────────────────────────────────

async function runStep(
	name: string,
	fn: () => Promise<string | void>,
	results: StepResult[],
): Promise<boolean> {
	const start = Date.now();
	log('');
	log('══════════════════════════════════════════════════════');
	log('  STEP: ' + name);
	log('══════════════════════════════════════════════════════');

	try {
		const details = await fn();
		const duration = Date.now() - start;
		results.push({
			step: name,
			durationMs: duration,
			success: true,
			details: typeof details === 'string' ? details : undefined,
		});
		log('  [PASS] (' + String(duration) + 'ms)' + (details ? ' — ' + details : ''));
		return true;
	} catch (err: unknown) {
		const duration = Date.now() - start;
		const errorMsg = err instanceof Error ? err.message : String(err);
		results.push({
			step: name,
			durationMs: duration,
			success: false,
			error: errorMsg,
		});
		log('  [FAIL] (' + String(duration) + 'ms) — ' + errorMsg);
		return false;
	}
}

// ── State Recorder ─────────────────────────────────────────────────────

function createStateRecorder(sessionId: string) {
	const events: RecordedEvent[] = [];
	let unsub: (() => void) | null = null;
	const start = Date.now();

	const record = (source: string, change: string): void => {
		const event = { relativeMs: Date.now() - start, source, change };
		events.push(event);
		log('[REC +' + String(event.relativeMs) + 'ms] ' + source + ': ' + change);
	};

	return {
		start: (): void => {
			let prevMessages = getMessages(sessionId).length;
			let prevStreaming = getStreamState(sessionId)?.isStreaming ?? false;
			let prevPlanMode = getPlanMode(sessionId);
			let prevAcceptMode = getAcceptMode(sessionId);
			let prevPermCount = getPendingPermissions().size;
			let prevConnectionState = getSession(sessionId)?.connectionState;

			unsub = useAgentStore.subscribe(() => {
				const messages = getMessages(sessionId);
				const streaming = getStreamState(sessionId)?.isStreaming ?? false;
				const planMode = getPlanMode(sessionId);
				const acceptMode = getAcceptMode(sessionId);
				const permCount = getPendingPermissions().size;
				const connState = getSession(sessionId)?.connectionState;

				if (messages.length !== prevMessages) {
					record('Messages', String(prevMessages) + ' -> ' + String(messages.length));
					prevMessages = messages.length;
				}
				if (streaming !== prevStreaming) {
					record('Streaming', String(streaming));
					prevStreaming = streaming;
				}
				if (planMode !== prevPlanMode) {
					record('PlanMode', String(prevPlanMode) + ' -> ' + String(planMode));
					prevPlanMode = planMode;
				}
				if (acceptMode !== prevAcceptMode) {
					record('AcceptMode', String(prevAcceptMode) + ' -> ' + String(acceptMode));
					prevAcceptMode = acceptMode;
				}
				if (permCount !== prevPermCount) {
					record('Permissions', String(prevPermCount) + ' -> ' + String(permCount));
					prevPermCount = permCount;
				}
				if (connState !== prevConnectionState) {
					record('Connection', String(prevConnectionState) + ' -> ' + String(connState));
					prevConnectionState = connState;
				}
			});

			record('Recorder', 'Started');
		},

		stop: (): RecordedEvent[] => {
			if (unsub) {
				unsub();
				unsub = null;
			}
			record('Recorder', 'Stopped (' + String(events.length) + ' events)');
			return [...events];
		},
	};
}

// ── State Snapshot ─────────────────────────────────────────────────────

function logState(sessionId: string, label: string): void {
	const session = getSession(sessionId);
	const messages = getMessages(sessionId);
	const stream = getStreamState(sessionId);

	log('');
	log('==== STATE: ' + label + ' ====');
	log('  Session ID:      ' + sessionId.slice(0, 16));
	log('  Connection:      ' + String(session?.connectionState));
	log('  SDK Session:     ' + String(session?.sdkSessionId?.slice(0, 16)));
	log('  Message count:   ' + String(messages.length));
	log('  Is streaming:    ' + String(stream?.isStreaming));
	log('  Plan mode:       ' + String(getPlanMode(sessionId)));
	log('  Accept mode:     ' + String(getAcceptMode(sessionId)));
	log('  Pending perms:   ' + String(getPendingPermissions().size));
	log('  ---');

	for (const [i, msg] of messages.entries()) {
		const preview = msg.content.slice(0, 80).replace(/\n/g, '\\n');
		const blockTypes = msg.blocks.map((b) => b.type).join(',');
		const toolCount = msg.toolCalls?.length ?? 0;
		log(
			'  [' + String(i) + '] ' + msg.role +
			(msg.isStreaming ? ' (streaming)' : '') +
			': "' + preview + '"' +
			' blocks=[' + blockTypes + ']' +
			(toolCount > 0 ? ' tools=' + String(toolCount) : ''),
		);
	}
	log('==== END STATE ====');
	log('');
}

// ── Summary Reporter ───────────────────────────────────────────────────

function logSummary(results: StepResult[]): void {
	const passed = results.filter((r) => r.success).length;
	const failed = results.filter((r) => !r.success).length;
	const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);

	log('');
	log('════════════════════════════════════════════════════════');
	log('  TEST COMPLETE — ' + (totalMs / 1000).toFixed(1) + 's total');
	log('════════════════════════════════════════════════════════');

	for (const r of results) {
		const icon = r.success ? '[PASS]' : '[FAIL]';
		const details = r.details ? ' — ' + r.details : '';
		log('  ' + icon + ' ' + r.step + ' (' + String(r.durationMs) + 'ms)' + details);
		if (r.error) {
			log('     Error: ' + r.error);
		}
	}

	log('');
	log('  Total: ' + String(passed) + ' passed, ' + String(failed) + ' failed');

	if (passed === results.length) {
		log('');
		log('  ALL ' + String(results.length) + ' STEPS PASSED!');
	}
	log('════════════════════════════════════════════════════════');
}

// ── Cleanup ────────────────────────────────────────────────────────────

/**
 * Cleans up sessions from previous stress test runs.
 * Prevents session accumulation from causing MAX_ACTIVE_SESSIONS eviction
 * issues or stale bridge connections on re-runs.
 */
function cleanupPreviousTestSessions(): void {
	const store = getStore();
	let cleaned = 0;

	for (const prevId of _previousTestSessionIds) {
		const session = store.sessions.get(prevId);
		if (session) {
			log('  Cleaning up previous test session: ' + prevId.slice(0, 16) + ' (state=' + session.connectionState + ')');
			store.deleteSession(prevId);
			cleaned++;
		}
	}

	// Clear the tracking array
	_previousTestSessionIds.length = 0;

	if (cleaned > 0) {
		log('  Cleaned up ' + String(cleaned) + ' previous test session(s)');
	}
}

// ── Main Runner ────────────────────────────────────────────────────────

export async function runAgentStressTest(config: TestConfig = {}): Promise<StepResult[]> {
	const {
		delayBetweenActions = 500,
		operationTimeout = 120_000,
		streamingStartTimeout = 30_000,
		createTimeout = 15_000,
		delayAfterModeChange = 1000,
		rapidCycleRounds = 5,
	} = config;

	const results: StepResult[] = [];
	const store = getStore();
	let sessionId = '';

	log('════════════════════════════════════════════════════════');
	log('  AGENT SESSION STRESS TEST — STARTING');
	log('════════════════════════════════════════════════════════');

	// Clean up sessions from previous runs to prevent stale bridge state
	cleanupPreviousTestSessions();
	// Give the backend a moment to tear down old bridge processes
	await sleep(500);

	log('  Config:');
	log('    operationTimeout:     ' + String(operationTimeout) + 'ms');
	log('    streamingStartTimeout: ' + String(streamingStartTimeout) + 'ms');
	log('    createTimeout:        ' + String(createTimeout) + 'ms');
	log('    delayBetweenActions:  ' + String(delayBetweenActions) + 'ms');
	log('    rapidCycleRounds:     ' + String(rapidCycleRounds));

	// ═══════════════════════════════════════════════════════════════════
	// STEP 1: Create Session
	// ═══════════════════════════════════════════════════════════════════

	const step1Ok = await runStep(
		'1. Create agent session',
		async () => {
			sessionId = await store.createSession();
			// Track for cleanup on re-runs
			_previousTestSessionIds.push(sessionId);
			log('  Created session: ' + sessionId);

			// Wait for session to become active (bridge connection established)
			await waitForSessionActive(sessionId, createTimeout);

			const session = getSession(sessionId);
			assertTrue(session !== undefined, 'Session should exist in store');
			assertEq(session!.connectionState, 'active', 'Session should be active');

			return 'sessionId=' + sessionId.slice(0, 16) + ', sdkSessionId=' + String(session!.sdkSessionId?.slice(0, 12));
		},
		results,
	);
	if (!step1Ok) {
		logSummary(results);
		return results;
	}

	// Start state recorder
	const recorder = createStateRecorder(sessionId);
	recorder.start();

	try {
	// ── All remaining steps wrapped in try/finally for cleanup ──

	await sleep(delayBetweenActions);

	// ═══════════════════════════════════════════════════════════════════
	// STEP 2: Basic Streaming
	// ═══════════════════════════════════════════════════════════════════

	const step2Ok = await runStep(
		'2. Send message + verify streaming',
		async () => {
			const msgCountBefore = getMessages(sessionId).length;
			const assistantCountBefore = getAssistantMessages(sessionId).length;

			await store.sendMessage(sessionId, 'Say exactly: "STRESS-TEST-ALPHA". Nothing else. Do NOT use any tools.');

			// Wait for streaming to start
			await waitForStreamingStarted(sessionId, streamingStartTimeout);
			log('  Streaming started');

			// Wait for result
			await waitForResultMessage(sessionId, assistantCountBefore, operationTimeout);

			const messages = getMessages(sessionId);
			assertGte(messages.length, msgCountBefore + 2, 'Should have user + assistant messages');

			const lastAssistant = getLastAssistantMessage(sessionId);
			assertTrue(lastAssistant !== undefined, 'Should have assistant message');
			assertFalse(lastAssistant!.isStreaming ?? false, 'Should not be streaming');
			assertTrue(lastAssistant!.content.length > 0, 'Should have content');
			assertHasBlock(lastAssistant!.blocks, 'text', 'Should have text block');

			logState(sessionId, 'After basic streaming');
			return 'Got ' + String(messages.length) + ' messages, content: "' + lastAssistant!.content.slice(0, 60) + '"';
		},
		results,
	);
	if (!step2Ok) {
		recorder.stop();
		logSummary(results);
		return results;
	}

	await sleep(delayBetweenActions);

	// ═══════════════════════════════════════════════════════════════════
	// STEP 3: Thinking Mode ON
	// ═══════════════════════════════════════════════════════════════════

	const step3Ok = await runStep(
		'3. Toggle thinking ON + verify thinking blocks',
		async () => {
			// Enable thinking
			await store.setThinkingMode(sessionId, true);
			log('  Thinking mode enabled');
			await sleep(delayAfterModeChange);

			const assistantCountBefore = getAssistantMessages(sessionId).length;

			await store.sendMessage(
				sessionId,
				'Think step by step about the number 42, then say exactly: "THINKING-VERIFIED". Do NOT use any tools.',
			);

			await waitForResultMessage(sessionId, assistantCountBefore, operationTimeout);

			const lastAssistant = getLastAssistantMessage(sessionId);
			assertTrue(lastAssistant !== undefined, 'Should have assistant message');

			// Check for thinking content
			const hasThinking = lastAssistant!.thinkingContent && lastAssistant!.thinkingContent.length > 0;
			const hasThinkingBlock = lastAssistant!.blocks.some((b) => b.type === 'thinking');

			log('  thinkingContent length: ' + String(lastAssistant!.thinkingContent?.length ?? 0));
			log('  Has thinking block: ' + String(hasThinkingBlock));
			log('  thinkingDurationMs: ' + String(lastAssistant!.thinkingDurationMs ?? 0));

			assertTrue(!!hasThinking, 'Should have thinking content (is extended thinking enabled on the model?)');
			assertTrue(hasThinkingBlock, 'Should have thinking block in ordered blocks');
			assertGte(lastAssistant!.thinkingDurationMs ?? 0, 1, 'Should have thinking duration > 0');

			logState(sessionId, 'After thinking mode ON');
			return 'Thinking: ' + String(lastAssistant!.thinkingContent?.length) + ' chars, ' + String(lastAssistant!.thinkingDurationMs) + 'ms';
		},
		results,
	);
	if (!step3Ok) {
		// Non-fatal: thinking may not be supported on all models, continue
		log('  (Thinking step failed — may not be supported on current model. Continuing.)');
	}

	await sleep(delayBetweenActions);

	// ═══════════════════════════════════════════════════════════════════
	// STEP 4: Thinking Mode OFF
	// ═══════════════════════════════════════════════════════════════════

	const step4Ok = await runStep(
		'4. Toggle thinking OFF + verify no thinking blocks',
		async () => {
			// Disable thinking
			await store.setThinkingMode(sessionId, false);
			log('  Thinking mode disabled');
			await sleep(delayAfterModeChange);

			const assistantCountBefore = getAssistantMessages(sessionId).length;

			await store.sendMessage(
				sessionId,
				'Say exactly: "NO-THINKING-TEST". Nothing else. Do NOT use any tools.',
			);

			await waitForResultMessage(sessionId, assistantCountBefore, operationTimeout);

			const lastAssistant = getLastAssistantMessage(sessionId);
			assertTrue(lastAssistant !== undefined, 'Should have assistant message');

			// Thinking should NOT be present on this message
			const hasNewThinking = lastAssistant!.thinkingContent && lastAssistant!.thinkingContent.length > 0;
			log('  thinkingContent: ' + String(lastAssistant!.thinkingContent?.length ?? 0) + ' chars');

			// Note: some models may still produce minimal thinking. We check that the blocks
			// don't contain a thinking block as the primary signal.
			assertFalse(!!hasNewThinking, 'Should NOT have thinking content with thinking disabled');

			logState(sessionId, 'After thinking mode OFF');
			return 'No thinking content — verified';
		},
		results,
	);
	// Non-fatal for thinking steps
	if (!step4Ok) {
		log('  (Step 4 failed — continuing)');
	}

	await sleep(delayBetweenActions);

	// ═══════════════════════════════════════════════════════════════════
	// STEP 5: Planning Mode Toggle
	// ═══════════════════════════════════════════════════════════════════

	const step5Ok = await runStep(
		'5. Toggle planning mode ON/OFF + verify store',
		async () => {
			// Check initial state
			const initialPlanMode = getPlanMode(sessionId);
			log('  Initial plan mode: ' + String(initialPlanMode));

			// Toggle ON
			await store.setPlanMode(sessionId, true);
			await sleep(delayAfterModeChange);

			// The backend emits plan_mode_changed which updates the store
			// Give it time to propagate
			const afterOn = getPlanMode(sessionId);
			log('  After toggle ON: ' + String(afterOn));
			assertTrue(afterOn, 'Plan mode should be ON after toggle');

			// Toggle OFF
			await store.setPlanMode(sessionId, false);
			await sleep(delayAfterModeChange);

			const afterOff = getPlanMode(sessionId);
			log('  After toggle OFF: ' + String(afterOff));
			assertFalse(afterOff, 'Plan mode should be OFF after toggle');

			return 'Plan mode toggled: ' + String(initialPlanMode) + ' -> true -> false';
		},
		results,
	);
	if (!step5Ok) {
		recorder.stop();
		logSummary(results);
		return results;
	}

	await sleep(delayBetweenActions);

	// ═══════════════════════════════════════════════════════════════════
	// STEP 6: Accept Mode ON + Tool Trigger
	// ═══════════════════════════════════════════════════════════════════

	const step6Ok = await runStep(
		'6. Accept mode ON + tool trigger (auto-approve)',
		async () => {
			// Enable accept mode (auto-approve)
			await store.setAcceptMode(sessionId, true);
			await sleep(delayAfterModeChange);

			const afterEnable = getAcceptMode(sessionId);
			log('  Accept mode enabled: ' + String(afterEnable));
			assertTrue(afterEnable, 'Accept mode should be ON');

			const assistantCountBefore = getAssistantMessages(sessionId).length;
			const permCountBefore = getPendingPermissions().size;

			// Send a prompt that triggers tool use
			await store.sendMessage(
				sessionId,
				'Read the file at /tmp/solo-stress-test-probe.txt using your file read tool. If it does not exist, just say "FILE-NOT-FOUND". Start your response with "ACCEPT-TEST:".',
			);

			// Wait for result — with auto-accept, should complete without manual approval
			await waitForResultMessage(sessionId, assistantCountBefore, operationTimeout);

			// With accept mode, there should be no pending permissions left
			const permCountAfter = getPendingPermissions().size;
			log('  Pending permissions before: ' + String(permCountBefore) + ', after: ' + String(permCountAfter));

			const lastAssistant = getLastAssistantMessage(sessionId);
			assertTrue(lastAssistant !== undefined, 'Should have assistant message');
			assertTrue(lastAssistant!.content.length > 0, 'Should have content');

			// Check if tools were used
			const toolCount = lastAssistant!.toolCalls?.length ?? 0;
			log('  Tool calls: ' + String(toolCount));

			logState(sessionId, 'After accept mode auto-approve');
			return 'Auto-approved with ' + String(toolCount) + ' tool calls, response: "' + lastAssistant!.content.slice(0, 60) + '"';
		},
		results,
	);
	if (!step6Ok) {
		// Non-fatal — tool behavior varies
		log('  (Step 6 failed — continuing)');
	}

	await sleep(delayBetweenActions);

	// ═══════════════════════════════════════════════════════════════════
	// STEP 7: Accept Mode OFF + Tool Trigger (Manual Permission)
	// ═══════════════════════════════════════════════════════════════════

	const step7Ok = await runStep(
		'7. Accept mode OFF + tool trigger (manual approval)',
		async () => {
			// Disable accept mode
			await store.setAcceptMode(sessionId, false);
			await sleep(delayAfterModeChange);

			const afterDisable = getAcceptMode(sessionId);
			log('  Accept mode disabled: ' + String(afterDisable));
			assertFalse(afterDisable, 'Accept mode should be OFF');

			const assistantCountBefore = getAssistantMessages(sessionId).length;

			// Send a prompt that will trigger tool use
			await store.sendMessage(
				sessionId,
				'Read the file at /tmp/solo-stress-test-manual.txt using your file read tool. Start your response with "MANUAL-TEST:".',
			);

			// Wait for either a permission request or result (model may not use tools)
			log('  Waiting for permission request or result...');

			const raceResult = await Promise.race([
				waitForPermissionRequest(operationTimeout).then((reqId) => ({ type: 'permission' as const, reqId })),
				waitForResultMessage(sessionId, assistantCountBefore, operationTimeout).then(() => ({ type: 'result' as const, reqId: '' })),
			]);

			if (raceResult.type === 'permission') {
				log('  Permission request received: ' + raceResult.reqId);

				// Approve the permission
				await store.respondPermission(raceResult.reqId, 'approve');
				log('  Permission approved');

				// Now wait for result
				await waitForResultMessage(sessionId, assistantCountBefore, operationTimeout);
			} else {
				log('  Model completed without tool use (permission flow not triggered)');
			}

			const lastAssistant = getLastAssistantMessage(sessionId);
			assertTrue(lastAssistant !== undefined, 'Should have assistant message');
			assertFalse(lastAssistant!.isStreaming ?? false, 'Should not be streaming');

			logState(sessionId, 'After manual permission');
			return 'Permission flow: ' + raceResult.type + ', tool calls: ' + String(lastAssistant!.toolCalls?.length ?? 0);
		},
		results,
	);
	if (!step7Ok) {
		log('  (Step 7 failed — continuing)');
	}

	await sleep(delayBetweenActions);

	// ═══════════════════════════════════════════════════════════════════
	// STEP 8: Interrupt Mid-Stream
	// ═══════════════════════════════════════════════════════════════════

	const step8Ok = await runStep(
		'8. Interrupt mid-stream',
		async () => {
			// Re-enable accept mode so tool approvals don't block the stream
			await store.setAcceptMode(sessionId, true);
			await sleep(500);

			// Send a long prompt to ensure streaming lasts long enough to interrupt
			await store.sendMessage(
				sessionId,
				'Write a detailed 500-word essay about the history of computing, starting from Charles Babbage. Start with "INTERRUPT-TEST:" and include many paragraphs. Do NOT use any tools.',
			);

			// Wait for streaming to start (first chunk arrives)
			await waitForStreamingStarted(sessionId, streamingStartTimeout);
			log('  Streaming started — waiting briefly before interrupt');

			// Give it a moment to accumulate some content
			await sleep(1500);

			const streamBefore = getStreamState(sessionId);
			const contentBefore = streamBefore?.streamingContent?.length ?? 0;
			log('  Content accumulated before interrupt: ' + String(contentBefore) + ' chars');

			// Interrupt!
			await store.interrupt(sessionId);
			log('  Interrupt sent');

			// Wait for streaming to stop
			await waitForStreamingComplete(sessionId, 10_000);

			const stream = getStreamState(sessionId);
			assertFalse(stream?.isStreaming ?? false, 'Streaming should be stopped');

			logState(sessionId, 'After interrupt');
			return 'Interrupted after ' + String(contentBefore) + ' chars streamed';
		},
		results,
	);
	if (!step8Ok) {
		log('  (Step 8 failed — continuing)');
	}

	await sleep(delayBetweenActions);

	// ═══════════════════════════════════════════════════════════════════
	// STEP 9: Rapid Mode Cycling
	// ═══════════════════════════════════════════════════════════════════

	await runStep(
		'9. Rapid mode cycling (' + String(rapidCycleRounds) + ' rounds)',
		async () => {
			// Reset modes
			await store.setAcceptMode(sessionId, false);
			await store.setThinkingMode(sessionId, false);
			await store.setPlanMode(sessionId, false);
			await sleep(500);

			let toggleCount = 0;

			for (let i = 0; i < rapidCycleRounds; i++) {
				log('  Round ' + String(i + 1) + '/' + String(rapidCycleRounds));

				// Toggle thinking ON and OFF rapidly
				await store.setThinkingMode(sessionId, true);
				toggleCount++;
				await sleep(100);
				await store.setThinkingMode(sessionId, false);
				toggleCount++;
				await sleep(100);

				// Toggle planning ON and OFF rapidly
				await store.setPlanMode(sessionId, true);
				toggleCount++;
				await sleep(100);
				await store.setPlanMode(sessionId, false);
				toggleCount++;
				await sleep(100);

				// Toggle accept ON and OFF rapidly
				await store.setAcceptMode(sessionId, true);
				toggleCount++;
				await sleep(100);
				await store.setAcceptMode(sessionId, false);
				toggleCount++;
				await sleep(100);
			}

			// Give backend time to process all toggles
			await sleep(1000);

			// Verify final states are clean
			const finalPlan = getPlanMode(sessionId);
			const finalAccept = getAcceptMode(sessionId);

			log('  Final plan mode: ' + String(finalPlan));
			log('  Final accept mode: ' + String(finalAccept));

			// Final states should be OFF (last toggle was OFF for each)
			assertFalse(finalPlan, 'Plan mode should be OFF after cycling');
			assertFalse(finalAccept, 'Accept mode should be OFF after cycling');

			// Verify session is still valid
			const session = getSession(sessionId);
			assertTrue(session !== undefined, 'Session should still exist');
			assertTrue(
				session!.connectionState === 'active' || session!.connectionState === 'archived',
				'Session should be active or archived (not crashed)',
			);

			// Verify store integrity — messages should still be there
			const messages = getMessages(sessionId);
			assertGte(messages.length, 2, 'Messages should be preserved after cycling');

			// Send a final message to prove the session is still functional
			const assistantCountBefore = getAssistantMessages(sessionId).length;
			await store.sendMessage(
				sessionId,
				'Say exactly: "CYCLE-SURVIVED". Nothing else. Do NOT use any tools.',
			);

			await waitForResultMessage(sessionId, assistantCountBefore, operationTimeout);

			const lastAssistant = getLastAssistantMessage(sessionId);
			assertTrue(lastAssistant !== undefined, 'Should get response after cycling');
			assertTrue(lastAssistant!.content.length > 0, 'Response should have content');

			logState(sessionId, 'After rapid mode cycling');
			return String(toggleCount) + ' toggles completed, session still functional';
		},
		results,
	);

	} finally {
		// ── Cleanup & Summary ──
		recorder.stop();

		// Delete the test session so re-runs start fresh
		if (sessionId) {
			log('  Cleaning up test session: ' + sessionId.slice(0, 16));
			try {
				store.deleteSession(sessionId);
				// Remove from tracking since we already cleaned it up
				const idx = _previousTestSessionIds.indexOf(sessionId);
				if (idx !== -1) _previousTestSessionIds.splice(idx, 1);
			} catch (cleanupErr) {
				log('  (Session cleanup failed: ' + String(cleanupErr) + ')');
			}
			// Give backend time to tear down the bridge process
			await sleep(300);
		}
	}

	logSummary(results);
	return results;
}
