---
name: virtualization
description: Plan for adding list/scroll virtualization across Solo's left sidebars (per window) and agent sessions. Draft — needs brainstorm + approval before implementation.
status: draft
created: 2026-04-17
---

# Plan — Sidebar + Agent Session Virtualization

Follows the UI overhaul (tokens + primitives + shims). This is the *next* structural project after the Codex-style design system is in place.

## Motivation

As Solo matures, three surfaces will render unbounded lists and can't hold 60fps without virtualization:

1. **Per-window left sidebars** — file tree, session threads, repo list, panel tabs. Today these are rendered as `.map()` over arrays. At 500+ files / 100+ sessions, React reconciliation + DOM layout cost compounds on every state change.
2. **Agent sessions** — message feed, tool-output streams, code-block rendering. A long Agent session (say, 50+ messages with streaming diffs) produces thousands of DOM nodes; scroll and input become laggy.
3. **Cross-cutting** — the scroll target (`ScrollArea` from `@solo/ui`) is ready; what's missing is the windowed rendering layer inside it.

Virtualization keeps the DOM node count bounded regardless of list length, collapsing render/layout cost from O(n) to O(visible).

## Surfaces — priority ladder

Ordered by user-visible win:

| # | Surface | Component(s) | Rough item count | Priority |
|---|---|---|---|---|
| 1 | Agent message feed | `components/agent/messages/message-feed.tsx` | 1 — ∞ per session; 200+ on long tool-heavy runs | **P0** |
| 2 | File tree | `components/file-explorer/FileTree.tsx` + `FileTreeNode.tsx` | 100 — 10,000 depending on repo | **P0** |
| 3 | Agent session list | `components/agent/SessionList.tsx`, `components/sidebar/SessionThreadList.tsx` | 10 — 200 per repo | **P1** |
| 4 | Tool-output blocks (inside message) | `components/agent/messages/tool-call-block.tsx` | tail-heavy (one giant bash dump) | **P1** |
| 5 | Repo list | `components/sidebar/RepoList.tsx` + `RepoItem.tsx` | 5 — 50 per user | **P2** |
| 6 | Horizontal tab bar | `components/sidebar/HorizontalTabBar.tsx` | 3 — 30 | **P2** |
| 7 | Terminal xterm viewport | terminal panel | already handled by xterm.js internally | N/A |
| 8 | Monaco editor | editor panel | already virtualized by Monaco | N/A |

P0 wins: agent message feed and file tree. These move first because (a) they are the highest-frequency perf complaints in IDEs and (b) they exercise two different virtualization styles — **variable-height** (messages) vs **tree/fixed-height** (file tree).

## Library choice

Three candidates, short evaluation:

| Library | Pros | Cons | Fit |
|---|---|---|---|
| `@tanstack/react-virtual` | Most mature. Hook-based (`useVirtualizer`). First-class variable-height support via `estimateSize` + measurement. Already common in Solo-adjacent projects. | Manual wrapper markup. | **Recommended** — versatile enough for every P0/P1/P2 surface. |
| `virtua` | Newer, claims higher perf on variable-size via ResizeObserver. Cleaner API (`<VList>`, `<VGrid>`). | Less ecosystem coverage; variable API across modes. | Strong runner-up if TanStack's measurement cadence causes jank on message streams. |
| `react-window` | Smallest bundle. | No variable-height without a second wrapper (`react-window-infinite-loader`, `react-virtualized-auto-sizer`). Bad fit for streamed message content. | Skip — doesn't serve our variable-size needs. |

**Decision (tentative):** TanStack Virtual. Standardise on `useVirtualizer` + a thin `<VirtualList>` / `<VirtualTree>` wrapper in `@solo/ui`. Evaluate virtua later if we find specific hot spots (likely the message feed during streaming).

## Library-neutral infrastructure

Two new `@solo/ui` primitives (wrapping whichever library wins), so call sites aren't coupled to the library:

### `<VirtualList>`
Signature:
```tsx
<VirtualList
  items={messages}
  estimateSize={(i) => measured.get(i) ?? 120}
  overscan={6}
  getItemKey={(i) => messages[i].id}
  renderItem={(item, virtualRow) => <MessageCell message={item} />}
  onReachBottom={loadMore}            // optional — infinite scroll hook
  stickToBottom                       // optional — follow-tail mode for streaming
  className="..."
/>
```

- **sticky-to-bottom mode** is critical for agent message feeds. When a new block arrives during streaming, the viewport must auto-scroll *unless* the user has scrolled up (classic "chat tail" behaviour).
- **overscan** defaults to 6 for variable-height lists; 3 for fixed.
- **getItemKey** defaults to `i` but every call site should provide a stable key so React doesn't remount cells on reorder.

### `<VirtualTree>`
Signature:
```tsx
<VirtualTree
  nodes={fileTreeFlat}                // pre-flattened tree with depth
  estimateSize={() => 24}             // file-tree rows are fixed height
  expandedIds={expanded}
  onToggleExpand={toggle}
  renderNode={(node, virtualRow) => <FileTreeRow node={node} />}
/>
```

Tree virtualization requires **flattening** the tree into a linear array of visible nodes (parents + expanded children), re-flattening on expand/collapse. A utility function `flattenTree(root, expanded)` lives next to `VirtualTree`.

## State-preservation concerns

Virtualization breaks several assumptions code might rely on:

1. **`Element.scrollIntoView()`** — items not in the DOM can't scroll to themselves. Replace with `virtualizer.scrollToIndex(i)`.
2. **`document.querySelector`** targeting items — won't find unmounted rows. Replace with imperative APIs on the virtualizer ref.
3. **CSS `:nth-child`** selectors — fail because virtual DOM only renders visible rows. Use `data-row-index` attrs instead, or apply alternating styles via CSS variables driven from JS.
4. **Focus management** — unmounting an item drops its focus. When a row mounts back, restore focus if it was previously focused (tracked in a ref). Especially matters for the file tree (arrow-key nav).
5. **Hover state over a scrolling list** — the hovered item may unmount mid-hover. Track `hoveredId` in state, not CSS `:hover`.
6. **`<AnimatePresence>` enter animations** — visible only when the row actually mounts. Long-list enter animations should be shimmed off or use `layout` animations driven by measured positions.
7. **Search highlighting** — if we virtualise the file tree, match-highlighting needs to persist across mounts. Store match positions in tree state, not DOM.

Each surface's migration PR must tick these boxes explicitly.

## Integration patterns

### Agent message feed (P0)

Current: `message-feed.tsx` renders `messages.map(m => <AgentMessage />)` inside a `div.overflow-y-auto`.

Target:
```tsx
<VirtualList
  items={messages}
  estimateSize={(i) => measurementsRef.current.get(messages[i].id) ?? 160}
  overscan={8}
  getItemKey={(i) => messages[i].id}
  stickToBottom={session.isStreaming}
  renderItem={(msg) => <AgentMessage message={msg} />}
/>
```

Challenges:
- **Message height varies wildly** — a one-line "👍" vs a 40-line diff + tool output. Use `estimateSize` + `measureElement` to dynamically size.
- **Streaming rows mutate** — a streaming message grows while visible. The virtualizer must re-measure on content change; TanStack Virtual's `observeElementRect` handles this.
- **Tool-call collapse/expand** — when a user collapses a tool block, the row shrinks drastically. The virtualizer needs re-measure on state change.

### File tree (P0)

Current: `FileTree.tsx` recursively renders `FileTreeNode`. Even collapsed branches contribute components.

Target: flatten on each render, pass to `<VirtualTree>`. Indentation via `depth` prop on each flat node.

```tsx
const flat = useMemo(() => flattenTree(root, expanded), [root, expanded]);

<VirtualTree
  nodes={flat}
  estimateSize={() => 24}
  overscan={20}
  renderNode={(n) => <FileTreeRow node={n} depth={n.depth} onToggle={() => toggle(n.id)} />}
/>
```

Keyboard navigation (↑↓ to move, →← to expand/collapse) needs explicit handling because focus doesn't persist across mounts. Keep a `focusedId` in state, `useEffect` to `scrollToIndex` when it changes, and steal focus on mount via `<FileTreeRow data-focused={n.id === focusedId}>`.

### Agent session list (P1)

Simpler than the message feed — sessions are flat, rows are fixed-height. Straight `<VirtualList>` with `estimateSize={() => 32}`.

### Tool-output block (P1)

For giant tool outputs (e.g., a `cargo build` log with 5,000 lines), the output block itself needs windowing. Could wrap `<StreamdownNarrative>` in a `<VirtualList>` keyed by line.

Simpler alternative: just truncate tool output at 500 lines + "view full" affordance. Lower-risk first pass.

## Performance targets

Measurement harness (a new task):

| Metric | Before (baseline to measure) | After (target) |
|---|---|---|
| Message feed first render (200 msgs, no streaming) | — | ≤ 50ms on M1 |
| Message feed interaction input latency | — | ≤ 16ms (60fps) |
| File tree first render (5,000 files) | — | ≤ 100ms |
| File tree scroll steady-state | — | 60fps |
| Tool-output render (5,000 lines) | — | ≤ 50ms |

Use the existing `scripts/codex-extract/` CDP harness idea as a template: spawn the app with remote-debugging, drive a stress script, record `Performance.metrics` and `performance.measure()` marks.

## Rollout order

| Phase | Work | Gating |
|---|---|---|
| V0 | Add `<VirtualList>` + `<VirtualTree>` primitives to `@solo/ui` with TanStack Virtual dep | typecheck + gallery entry |
| V1 | Migrate agent message feed | visual regression pass; streaming still tails correctly |
| V2 | Migrate file tree (flatten + virtualise) | keyboard nav test suite; focus restoration verified |
| V3 | Migrate agent session list | — |
| V4 | Migrate remaining P2 surfaces (repo list, tab bar) | — |
| V5 | Tool-output windowing (P1.b) | — |
| V6 | Performance harness + baseline + target verification | — |

Each phase = a separate brainstorm → spec → PR cycle. V0 lands first and unblocks V1–V5 in parallel.

## Risks

1. **TanStack Virtual's measurement loop vs React 19 concurrent rendering.** The virtualizer measures in `useEffect`; React 19's automatic batching may delay size updates during streaming. Known issue; monitor by watching for `[virtual] measurement race` console warnings and falling back to `virtua` if it bites.
2. **Scroll restoration across session switches.** When the user switches between agent sessions, message-feed scroll position should persist. TanStack Virtual exposes `scrollOffset`; we save it per session in `agentStore` on unmount, restore on mount.
3. **Find-in-page (Cmd+F) does not search unmounted rows.** Native browser find only reveals visible DOM. Mitigation: Solo's command palette already indexes everything via the embedding layer; direct users there for text search on long streams.
4. **React DevTools profiler becomes less useful.** When row components are unmounted, the profiler shows sparse trees. Add a `renderKind: 'virtual-cell'` annotation so we can filter.
5. **Snapshot tests / storybook entries break.** If any surface has snapshot tests, migrate them to use `@testing-library/react` with `userEvent.scroll` or similar, because snapshots on virtualised output only capture the visible window.

## Open questions

- **Per-window sidebar vs per-app sidebar** — Solo's sidebars are currently per-window (each mosaic tile has its own header/chrome). Do we virtualise the sidebar *contents* only, or the entire tile rail? Answer likely "contents" — the rail itself is fixed-count.
- **Does the mosaic layout's resize need to trigger re-measure?** Likely yes; hook `useEffect` on the tile's resized dimensions.
- **Do we want scroll-margin top/bottom** for pinned session headers? Gallery discussion.
- **Should `<VirtualList>` wrap `ScrollArea` from `@solo/ui`, or replace it?** Replacing is cleaner but loses the Radix ScrollArea styling. Wrapping means the Radix `Viewport` is the `getScrollElement` for the virtualizer. **Recommended: wrap.**

## Dependencies to add

```jsonc
// packages/ui/package.json
"@tanstack/react-virtual": "^3.10.x"
```

No runtime dependency on `react-dom/server` — virtualization is client-only and SSR doesn't apply (Tauri desktop).

## Next step

Brainstorm this plan (likely with the `brainstorming` skill) to convert into a formal spec, starting with V0 (the two `@solo/ui` primitives). The design skill (`.solo/skills/design/`) governs how those primitives are styled; this plan governs their mechanics.
