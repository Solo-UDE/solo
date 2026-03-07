---
name: mosaic
description: Create in-app stress tests that drive the real application pipeline from browser DevTools. No mocks — real state, real APIs, real UI. Works for any web app with observable state.
---

# Mosaic — In-App Stress Test Generator

Create stress tests that run inside the real application from the browser DevTools console. No mocks, no synthetic environments — real state management, real API calls, real async flows. Each test is a **tile** in a mosaic that reveals system integrity under pressure.

**Usage:** `/mosaic` then describe the feature, flow, or system you want to stress test.

---

## Philosophy

Traditional unit tests mock everything. Integration tests run outside the app. Mosaic tests run **inside** the live application, driving its real pipeline:

- State stores (Zustand, Redux, MobX, Jotai, Pinia, Svelte stores...)
- Backend communication (IPC, WebSocket, REST, gRPC, tRPC...)
- UI state transitions (routing, modals, streaming, concurrent operations...)
- File system operations, database calls, real AI/LLM responses

The result: tests that catch the bugs mocks hide — race conditions, state desynchronization, session remapping, mid-stream corruption, sidebar/UI ghost entries.

---

## Process

### Phase 1: Discover the Target

1. **Ask the user** what feature/flow to stress test (if not specified).
2. **Read existing stress tests** in the project (if any) to match conventions and patterns.
3. **Read the source code** of the feature:
   - Which state stores does it touch?
   - What async events does it emit/consume?
   - What are the state transitions? (idle → loading → streaming → complete → error)
   - Are there ID remappings, session switches, or concurrent operations?
4. **Identify the observation points** — which store properties change during the flow.

### Phase 2: Design the Test

Before writing code, output a plan:

```
## Mosaic Test Plan: [feature-name]

**Target:** [What feature/flow is being tested]
**Stores involved:** [Which state stores to observe]
**Events involved:** [Which events/messages are relevant]
**Concurrency:** [Any parallel operations, background tasks, or race conditions]

**Dependencies needed:**
- [action]: [type] — [what it's used for]

**Test Steps:**
1. [Step name] — [Act: what it does] → [Wait: what it waits for] → [Assert: what it checks]
2. [Step name] — ...

**Config options:**
- [option]: [default] — [description]

**Risk areas:**
- [What could go wrong, race conditions, edge cases to watch]
```

### Phase 3: Build the Test

Create the test file following the skeleton and building blocks below. The file structure is:

```
<test-directory>/<feature>-stress-test.ts
```

### Phase 4: Wire It Up

Expose the test via a global debug object on `window` so it can be run from DevTools:

```typescript
// In development-only initialization code:
if (import.meta.env.DEV) {
  window.__debug = {
    ...window.__debug,
    runMyTest: async (config?) => {
      const { runMyTest } = await import('./tests/my-stress-test');
      return runMyTest(dependencies, config);
    },
  };
}
```

**Key:** Use dynamic `import()` so test code is tree-shaken from production builds.

### Phase 5: Verify

1. Run type checking — no errors
2. Run linting — zero warnings
3. Report the DevTools invocation command to the user:
   ```
   window.__debug.runMyTest()
   window.__debug.runMyTest({ timeout: 60000 })
   ```

---

## The Skeleton

Every mosaic test follows this exact structure. Adapt the types and imports to your framework.

```typescript
/**
 * <Feature> Stress Test
 *
 * <What this test exercises, what it verifies, why it matters>
 *
 * Test sequence:
 *   1. <Step 1>
 *   2. <Step 2>
 *   ...
 *
 * Usage (from browser DevTools console):
 *   window.__debug.run<Feature>StressTest()
 *   window.__debug.run<Feature>StressTest({ <config> })
 *
 * Prerequisites:
 * - <What state the app must be in before running>
 */

// ── Types ──────────────────────────────────────────────────────────────

export interface TestDeps {
  // Actions the test needs from the host application.
  // Injected — never imported directly. This makes the test portable.
  sendMessage: (text: string) => void;
  stopAgent: () => void;
  // Add whatever actions your feature needs
}

export interface TestConfig {
  /** Delay between sequential actions (ms). Default: 500 */
  delayBetweenActions?: number;
  /** Timeout for async operations (ms). Default: 120000 */
  operationTimeout?: number;
  // Feature-specific configuration
}

interface StepResult {
  step: string;
  durationMs: number;
  success: boolean;
  details?: string;
  error?: string;
  // Add domain-specific metadata: sessionId, messageCount, sidebarCount, etc.
}

// ── Helpers ─────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Add: wait primitives, assertion helpers, state snapshots, recorder
// (See "Building Blocks" section below)

// ── Step Runner ─────────────────────────────────────────────────────────

// (See "Step Runner" building block below)

// ── Main Runner ─────────────────────────────────────────────────────────

export async function runTest(deps: TestDeps, config: TestConfig = {}): Promise<StepResult[]> {
  const { delayBetweenActions = 500, operationTimeout = 120_000 } = config;
  const results: StepResult[] = [];

  // Banner
  log('════════════════════════════════════════════════');
  log('  <FEATURE> STRESS TEST — STARTING');
  log('════════════════════════════════════════════════');

  // Start state recorder (optional)
  const recorder = createStateRecorder();
  recorder.start();

  // ── Steps ──
  // Each step: Act → Wait → Assert → Bail on failure

  const step1Ok = await runStep(
    'Step description',
    async () => {
      deps.sendMessage('...');
      await waitForCondition(operationTimeout, 'description');
      assertGte(getCount(), 2, 'Should have at least 2 items');
      return 'Summary of what happened';
    },
    results
  );
  if (!step1Ok) {
    recorder.stop();
    return results;
  }

  await sleep(delayBetweenActions);

  // ... more steps ...

  // ── Summary ──
  recorder.stop();
  logSummary(results);
  return results;
}
```

---

## Building Blocks

Copy and adapt these primitives into your test. Each is self-contained.

### 1. Wait Primitives

Wait for async conditions by subscribing to state stores. **Never poll** — subscribe and resolve when the condition is met.

```typescript
/**
 * Wait for a condition on a state store.
 * Works with any store that has a .subscribe() method (Zustand, Redux, etc.)
 *
 * @param store - The state store to watch
 * @param predicate - Returns true when the condition is met
 * @param timeout - Max wait time in ms
 * @param label - Descriptive label for timeout error messages
 */
function waitForStoreCondition<T>(
  store: { getState: () => T; subscribe: (fn: (state: T) => void) => () => void },
  predicate: (state: T) => boolean,
  timeout: number,
  label: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check immediately — condition might already be true
    if (predicate(store.getState())) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      unsub();
      reject(
        new Error(
          'Timeout (' +
            String(timeout) +
            'ms) waiting for: ' +
            label +
            '. Current state: ' +
            JSON.stringify(summarizeState(store.getState()))
        )
      );
    }, timeout);

    const unsub = store.subscribe((state) => {
      if (predicate(state)) {
        clearTimeout(timer);
        unsub();
        resolve();
      }
    });
  });
}
```

**Common specializations:**

```typescript
// Wait for an async operation to complete
function waitForComplete(timeout: number, label: string): Promise<void> {
  return waitForStoreCondition(
    appStore,
    (state) => !state.isLoading && !state.isPending,
    timeout,
    label
  );
}

// Wait for streaming to START (first data arrives)
function waitForStreamingStarted(timeout: number, label: string): Promise<void> {
  return waitForStoreCondition(
    appStore,
    (state) => state.isStreaming && state.items.length > 0,
    timeout,
    label
  );
}

// Wait for a new entity to be created (ID changes)
function waitForEntityCreated(prevId: string | null, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error('Timeout waiting for entity creation'));
    }, timeout);

    const unsub = appStore.subscribe((state) => {
      if (state.lastCreatedId && state.lastCreatedId !== prevId) {
        clearTimeout(timer);
        unsub();
        resolve(state.lastCreatedId);
      }
    });
  });
}

// Wait for a state transition (before → after)
function waitForTransition(
  fromCount: number,
  fromLastId: string | undefined,
  timeout: number
): Promise<void> {
  return waitForStoreCondition(
    appStore,
    (state) => {
      const items = getItems(state);
      return (
        items.length < fromCount || (items.length > 0 && items[items.length - 1]?.id !== fromLastId)
      );
    },
    timeout,
    'state transition from ' + String(fromCount) + ' items'
  );
}
```

### 2. Assertion Helpers

Simple throw-on-failure assertions. The step runner catches these.

```typescript
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

function assertLte(actual: number, expected: number, label: string): void {
  if (actual > expected) {
    throw new Error(label + ': expected <= ' + String(expected) + ', got ' + String(actual));
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

function assertContains(haystack: string, needle: string, label: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(
      label + ': expected to contain "' + needle + '" in "' + haystack.slice(0, 200) + '"'
    );
  }
}

function assertNoDuplicates<T>(items: T[], keyFn: (item: T) => string, label: string): void {
  const keys = items.map(keyFn);
  const unique = new Set(keys);
  if (unique.size !== keys.length) {
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    throw new Error(label + ': duplicates found: [' + dupes.join(', ') + ']');
  }
}
```

### 3. Step Runner

Wraps each step in try/catch with timing, logging, and result recording.

```typescript
async function runStep(
  name: string,
  fn: () => Promise<string | void>,
  results: StepResult[]
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
```

**Usage with bail-on-failure:**

```typescript
const stepOk = await runStep(
  'Send and verify',
  async () => {
    deps.sendMessage('Hello');
    await waitForComplete(timeout, 'Response');
    assertGte(getItems().length, 2, 'Should have request + response');
    return 'Got ' + String(getItems().length) + ' items';
  },
  results
);
if (!stepOk) return results; // Bail — downstream steps would cascade-fail
```

### 4. State Recorder

Subscribes to state stores and logs every mutation in real-time. Invaluable for debugging failed test runs.

```typescript
interface RecordedEvent {
  relativeMs: number;
  source: string;
  change: string;
}

function createStateRecorder() {
  const events: RecordedEvent[] = [];
  const unsubs: (() => void)[] = [];
  const start = Date.now();

  const record = (source: string, change: string): void => {
    const event = { relativeMs: Date.now() - start, source, change };
    events.push(event);
    log('[REC +' + String(event.relativeMs) + 'ms] ' + source + ': ' + change);
  };

  return {
    start: (): void => {
      // Subscribe to each store you want to monitor.
      // Compare prev vs current state on each notification.
      let prevState = store.getState();
      unsubs.push(
        store.subscribe((state) => {
          const prev = prevState;
          prevState = state;

          // Log specific changes you care about:
          if (state.activeId !== prev.activeId) {
            record('Store', 'activeId: ' + String(prev.activeId) + ' -> ' + String(state.activeId));
          }
          if (state.items.length !== prev.items.length) {
            record(
              'Store',
              'items: ' + String(prev.items.length) + ' -> ' + String(state.items.length)
            );
          }
          if (state.isLoading !== prev.isLoading) {
            record('Store', 'isLoading: ' + String(state.isLoading));
          }
          // Detect added/removed keys (session remap, entity creation/deletion)
          const prevKeys = Object.keys(prev.entities);
          const currKeys = Object.keys(state.entities);
          const added = currKeys.filter((k) => !prevKeys.includes(k));
          const removed = prevKeys.filter((k) => !currKeys.includes(k));
          if (added.length > 0) record('Store', 'ADDED: ' + added.join(', '));
          if (removed.length > 0) record('Store', 'REMOVED: ' + removed.join(', '));
        })
      );

      // Add more store subscriptions as needed
      record('Recorder', 'Started');
    },

    stop: (): RecordedEvent[] => {
      for (const unsub of unsubs) unsub();
      unsubs.length = 0;
      record('Recorder', 'Stopped (' + String(events.length) + ' events)');
      return [...events];
    },
  };
}
```

### 5. IPC / Message Interception

Wrap communication layers to capture outgoing messages. Essential for verifying that the right messages are sent (or NOT sent) under specific conditions.

```typescript
interface MessageCapture<T> {
  messages: T[];
  clear: () => void;
  getByType: (type: string) => T[];
  hasType: (type: string) => boolean;
  count: () => number;
}

function createMessageInterceptor<T extends { type: string }>(
  originalSend: (msg: T) => void
): { wrappedSend: (msg: T) => void; capture: MessageCapture<T> } {
  const messages: T[] = [];

  return {
    wrappedSend: (msg: T): void => {
      messages.push(msg);
      originalSend(msg); // Forward to real handler
    },
    capture: {
      messages,
      clear: (): void => {
        messages.length = 0;
      },
      getByType: (type: string): T[] => messages.filter((m) => m.type === type),
      hasType: (type: string): boolean => messages.some((m) => m.type === type),
      count: (): number => messages.length,
    },
  };
}
```

**Usage:**

```typescript
const { wrappedSend, capture } = createMessageInterceptor(deps.postMessage);
// Create actions that close over wrappedSend instead of the original
const interceptedActions = createActions({ postMessage: wrappedSend });

capture.clear();
interceptedActions.sendMessage('Hello');
await waitForComplete(timeout, 'Response');

// Verify the RIGHT messages were sent
assertGte(capture.getByType('message:send').length, 1, 'Should send message');
assertEq(capture.getByType('dangerous:action').length, 0, 'Should NOT send dangerous action');
```

### 6. State Snapshot Helpers

Log the full state at key moments for debugging failed runs.

```typescript
function logState(label: string): void {
  const state = store.getState();
  log('');
  log('==== STATE: ' + label + ' ====');
  log('  Active ID:   ' + String(state.activeId));
  log('  Item count:  ' + String(state.items.length));
  log('  Is loading:  ' + String(state.isLoading));
  log('  ---');

  for (const [i, item] of state.items.entries()) {
    const preview = String(item.content).slice(0, 80).replace(/\n/g, '\\n');
    log('  [' + String(i) + '] ' + item.type + ': "' + preview + '"');
  }
  log('==== END STATE ====');
  log('');
}
```

### 7. Summary Reporter

Print a structured report at the end of the test run.

```typescript
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
```

### 8. Subscription Efficiency Comparator

Measure and compare different state subscription patterns side-by-side during a real operation. Useful for verifying performance optimizations.

```typescript
interface PatternStats {
  callbackCount: number;
  rerenderTriggers: number;
}

function createDualSubscriptionComparator(store: StoreApi) {
  let oldCallbacks = 0,
    oldRerenders = 0;
  let newCallbacks = 0,
    newRerenders = 0;
  let oldPrevA = null,
    oldPrevB = null;
  let newPrevA = null,
    newPrevB = null;
  const unsubs: (() => void)[] = [];

  return {
    start: (): void => {
      const initial = store.getState();
      oldPrevA = initial.propA;
      oldPrevB = initial.propB;
      newPrevA = initial.propA;
      newPrevB = initial.propB;

      // OLD pattern: 2 separate subscriptions (simulates 2 hooks)
      unsubs.push(
        store.subscribe((s) => {
          oldCallbacks++;
          if (s.propA !== oldPrevA) {
            oldPrevA = s.propA;
            oldRerenders++;
          }
        })
      );
      unsubs.push(
        store.subscribe((s) => {
          oldCallbacks++;
          if (s.propB !== oldPrevB) {
            oldPrevB = s.propB;
            oldRerenders++;
          }
        })
      );

      // NEW pattern: 1 combined subscription (simulates useShallow)
      unsubs.push(
        store.subscribe((s) => {
          newCallbacks++;
          const aChanged = s.propA !== newPrevA;
          const bChanged = s.propB !== newPrevB;
          if (aChanged || bChanged) {
            newPrevA = s.propA;
            newPrevB = s.propB;
            newRerenders++;
          }
        })
      );
    },

    stop: (): { old: PatternStats; new: PatternStats } => {
      for (const u of unsubs) u();
      unsubs.length = 0;
      return {
        old: { callbackCount: oldCallbacks, rerenderTriggers: oldRerenders },
        new: { callbackCount: newCallbacks, rerenderTriggers: newRerenders },
      };
    },
  };
}
```

---

## Patterns Library

### Pattern: Send → Wait → Verify

The most basic pattern. Send an action, wait for completion, verify state.

```typescript
const stepOk = await runStep(
  'Send message and verify response',
  async () => {
    deps.sendMessage('Say exactly: "Hello World". Nothing else.');
    await waitForComplete(timeout, 'Response');

    const items = getItems();
    assertGte(items.length, 2, 'Should have request + response');

    const lastItem = items[items.length - 1];
    assertContains(lastItem.content, 'Hello World', 'Response content');
    return String(items.length) + ' items';
  },
  results
);
if (!stepOk) return results;
```

### Pattern: Concurrent Operations

Test what happens when multiple operations run simultaneously.

```typescript
// Start operation A
deps.sendMessage(LONG_PROMPT_A);
await waitForStreamingStarted(streamTimeout, 'A streaming');

// While A is streaming, start operation B
startNewContext();
deps.sendMessage(LONG_PROMPT_B);
await waitForStreamingStarted(streamTimeout, 'B streaming');

// Switch back to A while both are active
switchToContext(contextA);
await sleep(delayAfterSwitch);

// Verify both are intact
assertEq(getActiveContext(), contextA, 'Should be on context A');

// Wait for both to complete
await waitForComplete(timeout, 'A complete');
switchToContext(contextB);
await waitForComplete(timeout, 'B complete');
```

### Pattern: Rapid Context/Route Switching

Stress-test context switching by rapidly alternating between states.

```typescript
const contextA = resolveId('A');
const contextB = resolveId('B');

// Rapid switch: A → B → A → B → A (200ms gaps)
for (const target of [contextA, contextB, contextA, contextB, contextA]) {
  switchToContext(target);
  await sleep(200);
}

await sleep(delayAfterSwitch);

// Verify final state is clean
assertEq(getActiveContext(), contextA, 'Should end on A');
assertNoDuplicates(getSidebarEntries(), (e) => e.id, 'No duplicate sidebar entries');
```

### Pattern: Undo / Rewind / Rollback

Test state rollback to a previous point.

```typescript
// Build up state: msg1, msg2, msg3
for (const prompt of prompts) {
  deps.sendMessage(prompt);
  await waitForComplete(timeout, 'Response');
}

const preCount = getItems().length;
const target = findItemByIndex(2); // Rollback target

// Trigger rollback
deps.rollback(target.id);
await waitForTransition(preCount, getLastId(), 30_000);

// Verify state is truncated
assertLte(getItems().length, preCount, 'Items should be fewer after rollback');

// Send new message on rolled-back branch
deps.sendMessage('Verification message');
await waitForComplete(timeout, 'Post-rollback response');
```

### Pattern: File / Data Integrity Through State Changes

Track file or data state across mutations and verify rollback correctness.

```typescript
interface DataStateTracker {
  afterCreate: string | undefined;
  afterEdit1: string | undefined;
  afterEdit2: string | undefined;
}

const tracker: DataStateTracker = {
  afterCreate: undefined,
  afterEdit1: undefined,
  afterEdit2: undefined,
};

// Create
deps.sendMessage('Create a file at ' + path + ' with MARKER: ORIGINAL');
await waitForComplete(timeout, 'File creation');
tracker.afterCreate = await readData(path);
assertContains(tracker.afterCreate ?? '', 'MARKER: ORIGINAL', 'File created');

// Edit 1
deps.sendMessage('Change MARKER: ORIGINAL to MARKER: EDIT_1');
await waitForComplete(timeout, 'First edit');
tracker.afterEdit1 = await readData(path);
assertContains(tracker.afterEdit1 ?? '', 'MARKER: EDIT_1', 'First edit applied');

// Rollback to after create
deps.rollback(createStepMessageId);
await sleep(1000); // Give revert time
const reverted = await readData(path);
assertContains(reverted ?? '', 'MARKER: ORIGINAL', 'File reverted to original');
```

### Pattern: IPC Gating Verification

Verify that certain messages are sent (or NOT sent) based on configuration.

```typescript
const { wrappedSend, capture } = createMessageInterceptor(deps.postMessage);
const actions = createActions({ postMessage: wrappedSend });

// Configure: set to mode where "dangerous:action" should NOT be sent
actions.setMode('safe');
capture.clear();
actions.sendMessage('Test prompt');
await waitForComplete(timeout, 'Safe mode response');

assertEq(
  capture.getByType('dangerous:action').length,
  0,
  'Should NOT send dangerous:action in safe mode'
);
assertGte(capture.getByType('message:send').length, 1, 'Should send message:send');

// Now switch to mode where it SHOULD be sent
actions.setMode('full');
capture.clear();
actions.sendMessage('Test prompt 2');
await waitForComplete(timeout, 'Full mode response');

assertGte(
  capture.getByType('dangerous:action').length,
  1,
  'SHOULD send dangerous:action in full mode'
);
```

### Pattern: Store Subscription Efficiency

Measure whether an optimization actually reduces subscription overhead.

```typescript
const comparator = createDualSubscriptionComparator(store);
comparator.start();

// Run an operation that triggers many store updates
deps.sendMessage(MULTI_ACTION_PROMPT);
await waitForComplete(timeout, 'Multi-action response');

const stats = comparator.stop();

// Log comparison table
log(
  '  OLD (2 hooks): ' +
    String(stats.old.callbackCount) +
    ' callbacks, ' +
    String(stats.old.rerenderTriggers) +
    ' re-renders'
);
log(
  '  NEW (shallow): ' +
    String(stats.new.callbackCount) +
    ' callbacks, ' +
    String(stats.new.rerenderTriggers) +
    ' re-renders'
);

// Assert improvement
assertTrue(
  stats.new.callbackCount < stats.old.callbackCount,
  'New pattern should have fewer callbacks'
);
assertLte(
  stats.new.rerenderTriggers,
  stats.old.rerenderTriggers,
  'New pattern should have <= re-renders'
);
```

### Pattern: Ghost / Orphan Detection

Verify no phantom entries appear in UI lists after state transitions.

```typescript
const knownIds = new Set([resolveId('A'), resolveId('B'), resolveId('C')]);
const sidebarEntries = getSidebarEntries();

for (const entry of sidebarEntries) {
  if (!knownIds.has(entry.id) && entry.isEmpty && !store.getState().entities[entry.id]) {
    log('  GHOST detected: ' + entry.id + ' "' + entry.title + '"');
  }
}

assertNoDuplicates(sidebarEntries, (e) => e.id, 'No duplicate sidebar entries');
```

### Pattern: ID Remap Tracking

Track entity IDs through system remapping (frontend UUID → backend UUID).

```typescript
// Track created entities through possible remaps
const createdEntities: Record<string, string> = {}; // label → current ID

function resolveId(label: string): string {
  const id = createdEntities[label];
  if (!id) throw new Error('Unknown entity: ' + label);

  // Check if the ID was remapped
  const state = store.getState();
  if (id in state.remappedIds && !(id in state.entities)) {
    // Follow the remap chain
    const newId = state.remappedIds[id];
    if (newId) {
      createdEntities[label] = newId;
      return newId;
    }
  }
  return id;
}

function trackRemap(label: string): void {
  const currentId = getActiveId();
  const storedId = createdEntities[label];
  if (currentId && storedId && currentId !== storedId) {
    log('Entity ' + label + ' remapped: ' + storedId + ' -> ' + currentId);
    createdEntities[label] = currentId;
  }
}
```

---

## Prompt Engineering for Stress Tests

Design prompts that produce **predictable, verifiable** output:

| Technique               | Example                                                        | Use Case                                        |
| ----------------------- | -------------------------------------------------------------- | ----------------------------------------------- |
| **Boundary markers**    | `'Start with "ALPHA-START" and end with "ALPHA-END"'`          | Verify response boundaries after context switch |
| **Exact response**      | `'Say exactly: "Hello". Nothing else.'`                        | Fast steps, minimal latency                     |
| **Word count control**  | `'Write a detailed 350-word essay about...'`                   | Guarantee long streaming for mid-stream tests   |
| **Tool use trigger**    | `'Create a file at ~/Desktop/test.txt with content "..."'`     | Test tool execution pipeline                    |
| **No-tool guard**       | `'Do NOT use any tools.'`                                      | Prevent tool use in simple prompt steps         |
| **Memory marker**       | `'Remember the word "ALPHA". Reply: "Stored: ALPHA"'`          | Verify context integrity after rollback         |
| **Count verification**  | `'How many messages have I sent? Reply with just the number.'` | Verify context window after rewind              |
| **File content marker** | `'Change MARKER: ORIGINAL to MARKER: EDIT_1'`                  | Track file state through edits                  |

---

## Logging

Use your project's structured logger, not `console.log`. If the project uses a logger factory:

```typescript
const log = (msg: string): void => logger.warn(msg);
```

If no logger is available, use a simple wrapper:

```typescript
const PREFIX = '[MosaicTest]';
const log = (msg: string): void => console.warn(PREFIX + ' ' + msg);
```

**Why `warn` not `log`?** Most structured loggers filter `debug`/`info` in production. Using `warn` ensures test output is always visible in DevTools, even if other levels are suppressed.

**String concatenation for logging:** Use `'text ' + String(val)` not template literals. Many linters (including ESLint with strict rules) flag template literals in logging contexts.

---

## Configuration System

Every test should accept a config object with sensible defaults:

```typescript
export interface TestConfig {
  /** Delay between sequential actions (ms). Default: 500 */
  delayBetweenActions?: number;
  /** Timeout for async operations (ms). Default: 120000 */
  operationTimeout?: number;
  /** Delay before triggering rollback (ms). Default: 1000 */
  delayBeforeRollback?: number;
  /** Delay after switching context (ms). Default: 1500 */
  delayAfterSwitch?: number;
  /** Timeout for streaming start detection (ms). Default: 30000 */
  streamingStartTimeout?: number;
  /** Timeout for entity creation (ms). Default: 15000 */
  createTimeout?: number;
}
```

**Guideline for defaults:**

| Config                  | Default | Rationale                        |
| ----------------------- | ------- | -------------------------------- |
| `operationTimeout`      | 120s    | LLM responses can be slow        |
| `delayBetweenActions`   | 500ms   | Let state settle between steps   |
| `delayBeforeRollback`   | 1000ms  | Ensure checkpoints are committed |
| `delayAfterSwitch`      | 1500ms  | Let conversation load complete   |
| `streamingStartTimeout` | 30s     | First chunk can take time        |
| `createTimeout`         | 15s     | Entity creation round-trip       |

---

## Rules

1. **Real pipeline, no mocks** — the entire point is testing what mocks cannot.
2. **Prompts control output shape** — use boundary markers, word counts, exact responses.
3. **Always include timeouts** with descriptive labels — timeout errors should tell you WHAT was being waited for and WHAT the current state is.
4. **Log state snapshots** at every key moment — when a test fails at 3am, the console output is all you have.
5. **Bail early on failure** — if step 3 fails, steps 4-9 will cascade. Return `results` immediately.
6. **Track entity remaps** — frontend IDs often get remapped to backend IDs. Follow the chain.
7. **Dev-only gating** — dynamic imports + `import.meta.env.DEV` guards = zero production overhead.
8. **Deps injection, not direct imports** — tests receive actions as a dependency interface. This makes them portable and testable themselves.
9. **Record everything** — use state recorders during the test. The mutation timeline is the single most useful debugging artifact.
10. **Design for the worst case** — assume the test will fail. Make failure output as informative as success output.
