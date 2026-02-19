# Snowflake-V0 Parity Plan

Bring solo-oauth agent UI to feature parity with Snowflake-V0 reference app.

---

## Phase 1: ThinkingBox Component
**Priority: High | Effort: Small**

Replace the current inline italic text with a proper collapsible ThinkingBox.

### Changes:
- **New:** `components/agent/messages/thinking-box.tsx`
  - Collapsible panel with chevron toggle
  - "Thought for X seconds" header with duration tracking
  - Auto-expand when streaming starts, auto-collapse when streaming ends
  - `max-h-[500px]` with opacity transition
  - Props: `thinking: string`, `thinkingDurationMs?: number`, `isStreaming?: boolean`

- **Edit:** `stores/agentStore.ts`
  - Add `thinkingDurationMs?: number` to `Message`
  - Track thinking start time, calculate duration on each thinking chunk
  - Set final duration on message completion

- **Edit:** `components/agent/messageAdapter.ts`
  - Pass `thinkingDurationMs` and `isStreaming` in thinking render blocks

- **Edit:** `components/agent/messages/agent-message.tsx`
  - Replace inline italic `<div>` with `<ThinkingBox>` for `'thinking'` blocks

---

## Phase 2: Compact Permission Modal
**Priority: High | Effort: Small**

Replace the large amber card with a compact single-row inline bar matching Snowflake-V0.

### Changes:
- **Edit:** `components/agent/dialogs/ToolApprovalDialog.tsx` → rewrite `ToolApprovalInline`
  - Single-row layout: `[Spinner] [Confirm label] [file/terminal badge] [spacer] [Reject ⇧⌘⌫] [Accept ⌘⏎]`
  - Keyboard shortcuts: `Cmd+Enter` = approve, `Shift+Cmd+Backspace` = reject
  - Context-aware: File icon for file tools, Terminal icon for bash
  - Compact: ~40px height, `border-primary/30 bg-primary/5`
  - Clickable filename that opens the file

---

## Phase 3: Specialized Tool Widgets
**Priority: High | Effort: Large**

Replace generic `ToolCallBlock` with 10 tool-specific widgets.

### New Components:
1. **`tools/bash-tool-widget.tsx`** — Shiki syntax-highlighted command, "Running/Ran Bash" header, Loader2 spinner, collapsible output with 10-line truncation
2. **`tools/edit-tool-widget.tsx`** — GitHub DiffStat squares, old/new diff with red/green gutters, clickable filename
3. **`tools/write-tool-widget.tsx`** — Green-gutter new file preview, DiffStat, line numbers
4. **`tools/read-tool-widget.tsx`** — Compact inline "Read filename#L1-N", line count badge
5. **`tools/grep-tool-widget.tsx`** — Mode-aware output (files/count/content), grouped by file
6. **`tools/glob-tool-widget.tsx`** — Pattern display, clickable file results
7. **`tools/web-search-tool-widget.tsx`** — Query display, result links
8. **`tools/web-fetch-tool-widget.tsx`** — URL + prompt, output preview
9. **`tools/task-tool-widget.tsx`** — Description, subagent type badge
10. **`tools/todo-tool-widget.tsx`** — Checklist items with status

### Supporting Changes:
- **New:** `tools/diff-stat.tsx` — Reusable GitHub-style DiffStat squares (shared by Edit + Write)
- **Edit:** `stores/agentStore.ts` — Store full `toolInput` on ContentBlock (not just command/cwd)
- **Edit:** `components/agent/messageAdapter.ts` — Pass `toolName` and full `toolInput` in render blocks
- **Edit:** `components/agent/messages/agent-message.tsx` — Dispatch to correct widget based on `toolName`

### RenderBlock Changes:
```typescript
// Before:
{ type: 'toolCall'; id: string; command: string; cwd: string; exitCode?: number; output?: string; }

// After:
{ type: 'toolCall'; id: string; toolName: string; toolInput: Record<string, unknown>;
  status: 'running' | 'success' | 'error'; output?: string; }
```

---

## Phase 4: MessageActions
**Priority: Medium | Effort: Small**

Add Copy/Like/Dislike/Rewind buttons after completed messages.

### Changes:
- **New:** `components/agent/messages/message-actions.tsx`
  - Copy button (with 2s "Copied!" state)
  - ThumbsUp / ThumbsDown buttons
  - Rewind button (disabled on last message)
  - AI disclaimer text on last message

- **Edit:** `components/agent/messages/agent-message.tsx`
  - Show `<MessageActions>` after message completes (not streaming)

---

## Phase 5: InterruptIndicator
**Priority: Medium | Effort: Small**

Show visual feedback when agent is interrupted/stopped.

### Changes:
- **New:** `components/agent/messages/interrupt-indicator.tsx`
  - `XCircle` icon + "What can Solo do differently?" link + horizontal divider
  - Props: `onFeedback: () => void`

- **Edit:** `stores/agentStore.ts`
  - Add `isInterrupted?: boolean` to `Message`
  - Set `isInterrupted: true` when interrupt/stop occurs

- **Edit:** `components/agent/messages/agent-message.tsx`
  - Render `<InterruptIndicator>` when message has `isInterrupted: true`

---

## Phase 6: Streaming Animation
**Priority: Medium | Effort: Medium**

Add progressive content reveal (typewriter effect) for assistant text.

### Changes:
- **Edit:** `stores/agentStore.ts`
  - Add `displayedContent: string` to `Message` (for assistant messages)
  - Add 16ms interval that advances `displayedContent` by 3 chars toward `content`

- **Edit:** `components/agent/messageAdapter.ts`
  - Use `displayedContent` (not `content`) when building text render blocks

- **Evaluate:** Consider using `Streamdown` npm package instead of `ReactMarkdown` for streaming-aware markdown rendering (handles partial tokens without flicker)

---

## Phase 7: Deny = Stop Agent
**Priority: Medium | Effort: Small**

When user denies permission, stop the agent (matching Snowflake-V0 behavior).

### Changes:
- **Edit:** `stores/agentStore.ts` → `respondPermission`
  - On deny: also call `backend.agentInterrupt(sessionId)`
  - Clear all pending permissions (not just the denied one)
  - Mark current message as `isInterrupted: true`

---

## Phase 8: File Attachment Display
**Priority: Low | Effort: Small**

Show attached files/images on user messages.

### Changes:
- **Edit:** `stores/agentStore.ts` → `Message`
  - Add `attachedFiles?: string[]`, `attachedImages?: ImageAttachment[]`

- **Edit:** `components/agent/messages/user-message.tsx`
  - Render file pills below user message bubble (icon + filename)
  - Render image thumbnails

---

## Additional: Chat Width Constraint
**Priority: Medium | Effort: Tiny**

Restrict agent session chat window width for better readability during streaming.

### Changes:
- **Edit:** `components/agent/messages/message-feed.tsx` — Wrap each virtual item in `max-w-4xl mx-auto`
- **Edit:** `components/agent/AgentWindow.tsx` — Apply `max-w-4xl` to empty state container

Matches the existing `max-w-4xl mx-auto` constraint on `ChatInputContainer`.

---

## Implementation Order & Status

```
Phase 1: ThinkingBox           ✅ DONE — collapsible, duration tracking, auto-expand/collapse
Phase 2: Compact Permission    ✅ DONE — single-row bar, keyboard shortcuts (Cmd+Enter / ⇧⌘⌫)
Phase 3: Tool Widgets          ✅ DONE — 10 specialized widgets + DiffStat + renderToolWidget dispatcher
Phase 4: MessageActions        ✅ DONE — Copy/Like/Dislike + AI disclaimer
Phase 5: InterruptIndicator    ✅ DONE — XCircle + "What can Solo do differently?" + divider
Phase 6: Streaming Animation   ✅ DONE — useStreamingText hook (3 chars/16ms typewriter in AgentNarrative)
Phase 7: Deny = Stop           ✅ DONE — deny clears all permissions, interrupts agent, marks interrupted
Phase 8: Attachments           ✅ DONE — FileAttachment/ImageAttachment types, user-message renders pills/thumbnails
Chat Width                     ✅ DONE — max-w-4xl on MessageFeed items + empty state
```

All phases complete. ✅

## Verification After Each Phase

1. `bun run check` — TypeScript compiles ✅
2. `bun run dev` — App starts
3. Send a message that triggers the changed component
4. Visual comparison with Snowflake-V0 screenshot
