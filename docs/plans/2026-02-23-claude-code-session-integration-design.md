# Design: Claude Code Session Integration for Solo IDE

**Date:** 2026-02-23
**Status:** Approved (Approach B — Hybrid)
**Author:** Sachin + Claude
**Scope:** Read Claude Code's `~/.claude/` into Solo, write Solo's own data to `~/.solo/`

---

## Table of Contents

1. [Problem Statement & Use Case](#1-problem-statement--use-case)
2. [How Claude Code Stores Data](#2-how-claude-code-stores-data)
3. [How Solo Stores Data Today](#3-how-solo-stores-data-today)
4. [Architecture Decision: The Three Approaches](#4-architecture-decision-the-three-approaches)
5. [Chosen Approach: Hybrid (Read .claude/ + Write .solo/)](#5-chosen-approach-hybrid)
6. [Claude Code Storage — Full Reference](#6-claude-code-storage--full-reference)
7. [JSONL Session Format — Complete Schema](#7-jsonl-session-format--complete-schema)
8. [Solo Connector Architecture](#8-solo-connector-architecture)
9. [Implementation Phases](#9-implementation-phases)
10. [Format Translation: Claude Code → Solo](#10-format-translation-claude-code--solo)
11. [Edge Cases & Gotchas](#11-edge-cases--gotchas)
12. [Things Not Yet Considered](#12-things-not-yet-considered)
13. [File & Directory Reference](#13-file--directory-reference)

---

## 1. Problem Statement & Use Case

### The Problem

Solo IDE uses Claude Code as its agent backend via a Rust bridge (Node.js sidecar → Claude Agent SDK). When a user runs Claude Code in their terminal independently (outside Solo), those sessions are invisible to Solo. Conversely, Solo stores its own sessions in `~/.solo/sessions/` in a completely different format.

This creates a fragmented experience:
- Users lose context when switching between Solo and Claude Code CLI
- Memory, skills, and project learnings accumulated in Claude Code are not available in Solo
- Users can't search or browse their full agent history from one place

### The Goal

When a user opens Solo, they should see **every session** they've ever run — whether through Solo or through Claude Code CLI in a terminal. They should also have access to Claude Code's accumulated knowledge: project memory, skills, settings, file history, usage stats, plans, and tasks.

### The Bigger Vision

Solo is not just a Claude Code frontend. It will expand to support multiple agents, non-coding workflows, and custom providers. The session storage architecture must support this future without being locked into Claude Code's internal format.

### Use Cases

1. **Session History Browser** — User opens Solo, sees all Claude Code CLI sessions organized by project and date
2. **Context Continuity** — User starts a Claude Code session in terminal, switches to Solo, sees the full conversation and can continue from where they left off (via SDK resume)
3. **Memory Access** — Solo reads Claude Code's `MEMORY.md` files to show project learnings
4. **Unified Search** — Search across all sessions (Solo + Claude Code) from one interface
5. **Settings Sync** — Read Claude Code permissions, MCP servers, and plugin configs
6. **Usage Analytics** — Show token usage, session counts, model breakdown from Claude Code's stats
7. **File History** — Access Claude Code's file change snapshots for undo/diff

---

## 2. How Claude Code Stores Data

### Root Directory: `~/.claude/`

Claude Code uses a flat directory structure under `~/.claude/` (~2.2 GB on a typical active installation). There are **no databases** — everything is JSONL, JSON, or plain text files.

### Directory Map

```
~/.claude/                              # Root config directory
├── settings.json                       # User config (permissions, hooks, MCP servers, plugins)
├── .credentials.json                   # API credentials (encrypted)
├── history.jsonl                       # Global session index (all queries → sessionId + project)
├── stats-cache.json                    # Usage analytics (daily activity, model tokens, costs)
├── mcp-needs-auth-cache.json           # MCP authentication state
│
├── projects/                           # Per-project session storage (~2.2 GB)
│   └── {encoded-project-path}/         # e.g., -Users-sachin-Developer-MyProject
│       ├── {session-uuid}.jsonl        # Session conversation (JSONL event log)
│       ├── {session-uuid}/             # Session artifacts
│       │   ├── subagents/              # Sub-agent session JSONL files
│       │   │   └── agent-{id}.jsonl
│       │   └── tool-results/           # Large tool outputs (hashed .txt files)
│       │       └── {hash}.txt
│       ├── memory/
│       │   └── MEMORY.md               # Project-scoped persistent memory
│       └── CLAUDE.md                   # Project-level Claude Code instructions (if any)
│
├── file-history/                       # File change snapshots (~59 MB)
│   └── {uuid}/                         # Per-checkpoint file backups
│
├── shell-snapshots/                    # Shell environment snapshots (~85 MB)
│   └── snapshot-zsh-{timestamp}-{id}.sh
│
├── debug/                              # Debug logs (~400 MB)
│   └── {uuid}.txt                      # Per-session diagnostic logs
│
├── paste-cache/                        # Clipboard cache (~8.3 MB)
│   └── {hash}                          # Hashed paste content
│
├── tasks/                              # Task lists (~1.4 MB)
│   └── {slug}.md                       # Human-readable task files
│
├── plans/                              # Plan files (~1.5 MB)
│   └── {slug}.md                       # Human-readable plan files
│
├── plugins/                            # Installed plugins
│   └── cache/                          # Plugin code + skills
│
├── backups/                            # Periodic state snapshots
│   └── .claude.json.backup.*.json
│
├── todos/                              # Todo list storage
│   └── {session-uuid}/
│       └── {task-uuid}.json
│
└── worktrees/                          # Git worktree tracking
```

### Path Encoding Convention

Project directories use a simple encoding:
- The absolute filesystem path becomes the directory name
- Forward slashes (`/`) become dashes (`-`)
- The leading `/` becomes the first dash

```
/Users/sachin/Developer/Orbit_Main/solo
→ -Users-sachin-Developer-Orbit-Main-solo
```

**To decode:** Replace first `-` with `/`, then all remaining `-` with `/`.

**IMPORTANT CAVEAT:** This is lossy if directory names contain dashes. In practice, Claude Code doesn't handle this ambiguity — it's a 1:1 mapping because the original path is also stored inside session files as `cwd`. Always use the `cwd` field from session entries for the authoritative project path, not the decoded directory name.

---

## 3. How Solo Stores Data Today

### Location: `~/.solo/sessions/`

Solo persists sessions as individual JSON files (not JSONL).

### Format: v3 (current)

```json
{
  "version": 3,
  "metadata": {
    "id": "session-1771787656444-4zmgj4",
    "createdAt": "2026-02-22T19:14:16.552Z",
    "lastActiveAt": "2026-02-22T19:19:09.012Z",
    "model": "claude-opus-4-6",
    "title": "Can youu try to create a landi...",
    "name": null,
    "summary": null,
    "sdkSessionId": "059a5995-c7c4-4b2b-b619-4b4da976405b",
    "resumable": true,
    "workspacePath": "/Users/sachin/Developer/My_Projects",
    "worktreeId": null,
    "worktreeBranch": null,
    "totalTokens": 311384,
    "totalCost": 0.7786535,
    "turnCount": 1,
    "tags": []
  },
  "messages": [
    {
      "id": "msg-1771787677003-user",
      "role": "user",
      "content": "Can youu try to create a landing page...",
      "timestamp": "2026-02-22T19:14:37.004Z",
      "mode": "planning",
      "toolCalls": [],
      "isInterrupted": false,
      "thinkingContent": null,
      "thinkingDurationMs": null,
      "attachedFiles": [],
      "attachedImages": [],
      "attachments": [],
      "mentions": []
    }
  ]
}
```

### Key Differences from Claude Code Format

| Aspect | Claude Code | Solo |
|--------|-------------|------|
| **File format** | JSONL (one event per line, append-only) | Single JSON document |
| **Session ID** | UUID (`648dba46-...`) | Timestamp-based (`session-1771787656444-4zmgj4`) |
| **Messages** | Spread across multiple JSONL entries | Array in one `messages` field |
| **Tool calls** | Separate `tool_use` content blocks in assistant entries | `toolCalls` array inside message object |
| **Tool results** | Separate `user` entry with `tool_result` content | `output` field inside `toolCalls` |
| **Thinking** | Separate `thinking` content block | `thinkingContent` field on message |
| **Metadata** | Spread across every entry (`cwd`, `gitBranch`, `version`) | Centralized `metadata` object |
| **Usage** | `usage` object per assistant message + external stats-cache | `totalTokens` + `totalCost` on metadata |
| **Threading** | `parentUuid` → `uuid` chain | Implicit array order |
| **Streaming** | Append-only log (survives crashes) | Atomic write (may lose in-progress) |

### Solo Backend (Rust)

`session_commands.rs` provides:
- `session_get_dir()` → `~/.solo/sessions/`
- `session_list_files()` → list all session IDs
- `session_read_file(id)` → raw JSON string
- `session_write_file(id, content)` → atomic write (tmp → rename)
- `session_delete_file(id)` → delete with safety checks

### Solo Frontend (TypeScript)

`sessionPersistence.ts` provides:
- `loadAllSessions()` — reads all `.json` files, returns sessions array
- `saveSession(session)` — debounced write (1s), immediate for sdkSessionId changes
- `deleteSession(id)` — removes from disk
- `migrateFromLocalStorage()` — v2 → v3 migration

---

## 4. Architecture Decision: The Three Approaches

### Approach A: Shared `.claude/` (Write to Claude Code's directories)

**Solo writes sessions directly into `~/.claude/` in Claude Code's JSONL format.**

| Pro | Con |
|-----|-----|
| True interop — sessions resumable from CLI or Solo | Format coupling — Anthropic can change schema at any release |
| Zero duplication | Corruption risk — two processes writing without locking |
| Fastest to start | Can't store non-Claude data (other LLMs, custom agents) |
| | Business lock-in — data layer owned by another company |
| | No schema evolution control |

**Verdict:** Fast start, terrible for scale. Building on sand.

### Approach B: Own `.solo/` + Read from `.claude/` ← CHOSEN

**Solo owns `~/.solo/` for all its data. Reads `~/.claude/` as a secondary data source (connector).**

| Pro | Con |
|-----|-----|
| Full control of schema | Need JSONL parser for Claude Code format |
| Zero corruption risk (read-only) | Sessions started in Solo not visible in CLI |
| Immediate value (users see all history) | Some storage duplication |
| Scale-ready (multi-agent, multi-provider) | |
| Claude Code = one connector among many | |

**Verdict:** Best balance of time-to-value and future flexibility.

### Approach C: Pure `.solo/` (No `.claude/` reading)

**Build everything from scratch. Ignore `~/.claude/` entirely.**

| Pro | Con |
|-----|-----|
| Cleanest architecture | Users lose all Claude Code history |
| No external dependencies | Can't leverage existing memory/skills |
| | Bad UX — feels like starting from zero |

**Verdict:** Too slow to deliver value.

### Decision: Approach B (Hybrid)

The mental model is **"Claude Code as a connector"** — just like you'd have a GitHub connector, a Jira connector, or a Notion connector. The `.claude/` directory is read-only data source #1. Solo's own sessions live in `.solo/`.

---

## 5. Chosen Approach: Hybrid

### Architecture Overview

```
~/.solo/                                ← SOLO OWNS (read + write)
├── sessions/                           ← Solo's sessions (v3+ JSON format)
├── connectors/
│   └── claude-code/
│       ├── index.json                  ← Cached session index (from history.jsonl)
│       ├── sessions-cache/             ← Parsed/transformed session cache
│       └── last-sync.json              ← Last sync timestamp
├── memory/                             ← Solo's unified memory
├── settings.json                       ← Solo's settings
└── analytics/                          ← Unified usage analytics

~/.claude/                              ← READ-ONLY SOURCE
├── projects/                           ← Session JSONL files
├── history.jsonl                       ← Global index
├── settings.json                       ← Permissions, MCP, plugins
├── stats-cache.json                    ← Usage data
└── ...everything else
```

### Data Flow

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  ~/.claude/      │────▶│  Claude Code Connector │────▶│  Solo UI        │
│  (read-only)     │     │  (Rust + TS)          │     │  (React)        │
└─────────────────┘     └──────────────────────┘     └─────────────────┘
                              │                            ▲
                              ▼                            │
                        ┌──────────────────────┐          │
                        │  ~/.solo/connectors/  │          │
                        │  claude-code/cache    │──────────┘
                        └──────────────────────┘

┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  Agent Bridge    │────▶│  Solo Session Manager │────▶│  Solo UI        │
│  (live sessions) │     │  (Rust + TS)          │     │  (same React)   │
└─────────────────┘     └──────────────────────┘     └─────────────────┘
                              │
                              ▼
                        ┌──────────────────────┐
                        │  ~/.solo/sessions/    │
                        │  (v3 JSON format)     │
                        └──────────────────────┘
```

### Unified Session Model

The frontend sees a single `UnifiedSession` type regardless of source:

```typescript
interface UnifiedSession {
  // Identity
  id: string;                          // Solo ID or Claude Code UUID
  source: 'solo' | 'claude-code';      // Where it came from
  externalId?: string;                 // Claude Code UUID (if source is claude-code)

  // Metadata
  title: string;                       // First message preview or user-assigned name
  slug?: string;                       // Claude Code's human-readable slug
  createdAt: string;                   // ISO 8601
  lastActiveAt: string;                // ISO 8601
  model: string;                       // Primary model used
  projectPath: string;                 // Workspace directory
  gitBranch?: string;                  // Active branch

  // Stats
  messageCount: number;
  turnCount: number;
  totalTokens?: number;
  totalCost?: number;

  // Capabilities
  resumable: boolean;                  // Can be continued
  sdkSessionId?: string;              // For SDK resume (Solo sessions only)

  // Content (loaded on demand)
  messages?: UnifiedMessage[];         // Lazy-loaded
}

interface UnifiedMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;                     // Plain text content
  timestamp: string;
  thinkingContent?: string;
  toolCalls?: UnifiedToolCall[];
  usage?: TokenUsage;
}
```

---

## 6. Claude Code Storage — Full Reference

### 6.1 `history.jsonl` — Global Session Index

**Location:** `~/.claude/history.jsonl`
**Format:** JSONL (one JSON object per line)
**Size:** ~2.9 MB (3,800+ lines on active install)

Each line represents one user query:

```json
{
  "display": "can you fix the login bug",
  "pastedContents": {},
  "timestamp": 1764446938054,
  "project": "/Users/sachin/Developer/MyProject",
  "sessionId": "8325a4f7-d217-4997-9ca4-8be037466ee6"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `display` | string | User's query text (may be truncated) |
| `pastedContents` | object | Pasted content references (usually empty) |
| `timestamp` | number | Unix timestamp in **milliseconds** |
| `project` | string | Absolute project path |
| `sessionId` | string | UUID of the session |

**Usage:** This is the primary index for discovering sessions. Scan this file to build a session list with project mappings.

**Gotcha:** Multiple entries can share the same `sessionId` (one per user message in the session). To get unique sessions, deduplicate by `sessionId` and take the latest `timestamp`.

### 6.2 `settings.json` — User Configuration

**Location:** `~/.claude/settings.json`

```json
{
  "permissions": {
    "allow": ["WebFetch(domain:pypi.org)"]
  },
  "hooks": {
    "Notification": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "osascript -e '...'"
      }]
    }]
  },
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh"
  },
  "enabledPlugins": {
    "slack@claude-plugins-official": true,
    "context7@claude-plugins-official": true
  },
  "alwaysThinkingEnabled": true,
  "commit_message_suffix": "",
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

| Section | What Solo Can Use |
|---------|-------------------|
| `permissions` | Display allowed tools/domains |
| `hooks` | Show configured automation |
| `enabledPlugins` | Show active plugins/skills |
| `mcpServers` | List available MCP integrations |
| `alwaysThinkingEnabled` | Match thinking mode preference |

### 6.3 `stats-cache.json` — Usage Analytics

**Location:** `~/.claude/stats-cache.json`

```json
{
  "version": 1,
  "lastComputedDate": "2026-02-22",
  "dailyActivity": [
    { "date": "2025-12-29", "messageCount": 3556, "sessionCount": 5, "toolCallCount": 1026 }
  ],
  "dailyModelTokens": [
    { "date": "2025-12-29", "tokensByModel": { "claude-opus-4-5-20251101": 535732 } }
  ],
  "modelUsage": {
    "claude-opus-4-6": {
      "inputTokens": 1074181,
      "outputTokens": 2230143,
      "cacheReadInputTokens": 3258060281,
      "cacheCreationInputTokens": 229104142,
      "costUSD": 0
    }
  },
  "totalSessions": 933,
  "totalMessages": 141614,
  "longestSession": {
    "sessionId": "d33974b7-...",
    "duration": 736406498,
    "messageCount": 105
  },
  "firstSessionDate": "2025-12-29T01:06:32.683Z",
  "hourCounts": { "0": 40, "1": 64 }
}
```

### 6.4 Project Memory — `MEMORY.md`

**Location:** `~/.claude/projects/{encoded-path}/memory/MEMORY.md`

Plain markdown file with accumulated project learnings. Claude Code reads this at the start of every session in that project. Contains patterns, conventions, architectural decisions, and user preferences discovered across sessions.

### 6.5 Plans & Tasks

**Location:** `~/.claude/plans/{slug}.md` and `~/.claude/tasks/{slug}.md`
**Format:** Markdown files with auto-generated slug names (e.g., `squishy-crafting-lovelace.md`)
**Count:** ~199 each on active install

These contain structured plans and task lists from Claude Code sessions — useful for showing "what was the agent working on."

### 6.6 File History

**Location:** `~/.claude/file-history/{uuid}/`
**Content:** Snapshots of files before/after modifications
**Usage:** Enables undo/diff of changes Claude Code made

### 6.7 Shell Snapshots

**Location:** `~/.claude/shell-snapshots/snapshot-zsh-{timestamp}-{id}.sh`
**Content:** Shell environment captures
**Usage:** Lower priority — could be used for environment reproduction

### 6.8 Debug Logs

**Location:** `~/.claude/debug/{uuid}.txt`
**Size:** ~400 MB total
**Usage:** Diagnostic only — not for user-facing features

---

## 7. JSONL Session Format — Complete Schema

### Location

```
~/.claude/projects/{encoded-project-path}/{session-uuid}.jsonl
```

### Event Types

Each line in the JSONL file is one event. The `type` field determines the schema:

#### 7.1 `file-history-snapshot`

Appears at session start and periodically. Tracks file modification checkpoints.

```json
{
  "type": "file-history-snapshot",
  "messageId": "uuid",
  "snapshot": {
    "messageId": "uuid",
    "trackedFileBackups": {},
    "timestamp": "2026-02-21T21:30:19.206Z"
  },
  "isSnapshotUpdate": false
}
```

#### 7.2 `progress`

Hook execution, tool lifecycle, background task progress.

```json
{
  "parentUuid": "uuid-or-null",
  "isSidechain": false,
  "userType": "external",
  "cwd": "/absolute/path",
  "sessionId": "session-uuid",
  "version": "2.1.50",
  "gitBranch": "branch-name",
  "slug": "human-readable-slug",
  "type": "progress",
  "data": {
    "type": "hook_progress",
    "hookEvent": "SessionStart",
    "hookName": "SessionStart:clear",
    "command": "shell command"
  },
  "parentToolUseID": "tool-uuid-or-null",
  "toolUseID": "tool-uuid-or-null",
  "timestamp": "ISO-8601",
  "uuid": "entry-uuid"
}
```

#### 7.3 `user` — User Message

**Initial prompt:**
```json
{
  "parentUuid": null,
  "isSidechain": false,
  "userType": "external",
  "cwd": "/path/to/workspace",
  "sessionId": "session-uuid",
  "version": "2.1.50",
  "gitBranch": "branch-name",
  "slug": "human-readable-slug",
  "type": "user",
  "message": {
    "role": "user",
    "content": "User's text message"
  },
  "uuid": "entry-uuid",
  "timestamp": "ISO-8601"
}
```

**Tool result (after agent calls a tool):**
```json
{
  "parentUuid": "previous-assistant-uuid",
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      {
        "tool_use_id": "toolu_01ET2vfgdtRXDRkRbMdcG77X",
        "type": "tool_result",
        "content": "Tool output text..."
      }
    ]
  },
  "toolUseResult": { },
  "sourceToolAssistantUUID": "assistant-uuid-that-called-the-tool"
}
```

**Key:** When `message.content` is a string → user typed it. When it's an array of `tool_result` objects → it's a tool response.

#### 7.4 `assistant` — Assistant Message

**CRITICAL:** A single API response is split across **multiple JSONL lines**. Each line contains exactly one content block type. Lines from the same API call share the same `requestId`.

**Text block:**
```json
{
  "parentUuid": "user-uuid",
  "type": "assistant",
  "requestId": "req_011CYMvhmTswpGbdxidmybFJ",
  "message": {
    "model": "claude-opus-4-6",
    "id": "msg_01DJKtjPBXzUhj6eKCfMofce",
    "type": "message",
    "role": "assistant",
    "content": [
      { "type": "text", "text": "I'll help you with that..." }
    ],
    "stop_reason": null,
    "stop_sequence": null,
    "usage": {
      "input_tokens": 3,
      "cache_creation_input_tokens": 59398,
      "cache_read_input_tokens": 10608,
      "output_tokens": 2,
      "service_tier": "standard",
      "inference_geo": "not_available"
    }
  },
  "uuid": "entry-uuid",
  "timestamp": "ISO-8601"
}
```

**Thinking block:**
```json
{
  "type": "assistant",
  "requestId": "same-request-id",
  "message": {
    "content": [
      {
        "type": "thinking",
        "thinking": "Internal reasoning...",
        "signature": "base64-signature"
      }
    ],
    "stop_reason": null
  }
}
```

**Tool use block:**
```json
{
  "type": "assistant",
  "requestId": "same-request-id",
  "message": {
    "content": [
      {
        "type": "tool_use",
        "id": "toolu_01ET2vfgdtRXDRkRbMdcG77X",
        "name": "Read",
        "input": { "file_path": "/path/to/file" },
        "caller": { "type": "direct" }
      }
    ],
    "stop_reason": "tool_use"
  }
}
```

**Reassembly rule:** To reconstruct a full assistant message, group all entries with the same `requestId` and concatenate their `message.content` arrays. The final entry (with `stop_reason` != null) marks the end.

#### 7.5 `queue-operation`

Background task queue management.

```json
{
  "type": "queue-operation",
  "operation": "enqueue",
  "timestamp": "ISO-8601",
  "sessionId": "session-uuid",
  "content": "{\"task_id\":\"b7b3a65\",\"tool_use_id\":\"toolu_...\",\"description\":\"Generate bindings\",\"task_type\":\"local_bash\"}"
}
```

#### 7.6 `system`

Session metadata and turn metrics.

```json
{
  "type": "system",
  "subtype": "turn_duration",
  "durationMs": 47719,
  "timestamp": "ISO-8601",
  "uuid": "entry-uuid"
}
```

### Common Fields (Present on Most Entry Types)

| Field | Type | Description |
|-------|------|-------------|
| `parentUuid` | string \| null | Links to previous message in conversation thread |
| `isSidechain` | boolean | `true` for subagent entries |
| `userType` | string | `"external"` for user-initiated |
| `cwd` | string | Current working directory |
| `sessionId` | string | Session UUID |
| `version` | string | Claude Code version (e.g., `"2.1.50"`) |
| `gitBranch` | string | Active git branch |
| `slug` | string | Human-readable session name (e.g., `"squishy-crafting-lovelace"`) |
| `uuid` | string | Unique entry identifier |
| `timestamp` | string | ISO 8601 timestamp |

### Session Timeline (Typical Order)

```
1.  file-history-snapshot         ← Session initialization
2.  progress (hook_progress)      ← Hook execution (SessionStart)
3.  user                          ← User's first message
4.  assistant (thinking)          ← Extended thinking block
5.  assistant (text)              ← Response text
6.  assistant (tool_use)          ← Tool invocation
7.  progress                      ← Tool execution progress
8.  user (tool_result)            ← Tool output
9.  assistant (text)              ← Continue response
10. queue-operation (enqueue)     ← Background task
11. queue-operation (remove)      ← Task completed
12. system (turn_duration)        ← Turn metrics
```

### Subagent Sessions

Stored in `{session-uuid}/subagents/agent-{id}.jsonl`
Same JSONL format but with:
- `isSidechain: true`
- Additional `agentId` field
- `sessionId` still points to parent session

### Large Tool Results

When tool output exceeds a threshold, it's stored externally:
```
{session-uuid}/tool-results/{hash}.txt
```
The JSONL entry references this via a truncated result with a note about the external file.

---

## 8. Solo Connector Architecture

### Layer Design

```
┌──────────────────────────────────────────────────────┐
│  Solo Frontend (React)                                │
│  ┌──────────────────────────────────────────────────┐│
│  │  useUnifiedSessions() hook                       ││
│  │  - Merges Solo sessions + Claude Code sessions   ││
│  │  - Sorts by lastActiveAt                         ││
│  │  - Filters by project, model, date              ││
│  └──────────────────────────────────────────────────┘│
│                        │                              │
│          ┌─────────────┴──────────────┐              │
│          ▼                            ▼              │
│  ┌──────────────────┐    ┌──────────────────────┐    │
│  │ Solo Sessions     │    │ Claude Code Connector │    │
│  │ (existing store)  │    │ (new Zustand store)   │    │
│  └──────────────────┘    └──────────────────────┘    │
└──────────────────────────────────────────────────────┘
           │                            │
           ▼                            ▼
    ┌──────────────┐          ┌───────────────────┐
    │ Rust Commands │          │ Rust Connector    │
    │ session_*     │          │ claude_code_*     │
    └──────────────┘          └───────────────────┘
           │                            │
           ▼                            ▼
    ~/.solo/sessions/            ~/.claude/ (read-only)
```

### Rust Commands (New Module: `claude_code_commands.rs`)

```rust
// Discovery
claude_code_list_projects() → Vec<ClaudeCodeProject>
claude_code_list_sessions(project_path: String) → Vec<ClaudeCodeSessionMeta>
claude_code_read_session(project_path: String, session_id: String) → ClaudeCodeSession

// Memory & Context
claude_code_read_memory(project_path: String) → Option<String>
claude_code_read_settings() → ClaudeCodeSettings

// Analytics
claude_code_read_stats() → ClaudeCodeStats

// History index
claude_code_read_history(limit: usize, offset: usize) → Vec<HistoryEntry>

// File history
claude_code_list_file_snapshots(session_id: String) → Vec<FileSnapshot>

// Plans & Tasks
claude_code_list_plans() → Vec<PlanMeta>
claude_code_read_plan(slug: String) → String
claude_code_list_tasks() → Vec<TaskMeta>
claude_code_read_task(slug: String) → String
```

### TypeScript Store (New: `claudeCodeStore.ts`)

```typescript
interface ClaudeCodeState {
  // Discovery
  projects: Map<string, ClaudeCodeProject>;
  sessions: Map<string, ClaudeCodeSessionMeta>;

  // Loaded content
  loadedSessions: Map<string, ClaudeCodeSession>;
  projectMemories: Map<string, string>;

  // Status
  isScanning: boolean;
  lastSyncAt: string | null;
  claudeCodeAvailable: boolean;  // Is ~/.claude/ present?
}

interface ClaudeCodeActions {
  scanProjects(): Promise<void>;
  loadSessionList(projectPath: string): Promise<void>;
  loadSession(projectPath: string, sessionId: string): Promise<void>;
  loadMemory(projectPath: string): Promise<void>;
  loadSettings(): Promise<void>;
  loadStats(): Promise<void>;
}
```

---

## 9. Implementation Phases

### Phase 1: Foundation (Start Here)

**Goal:** Read and display Claude Code session history in Solo.

1. Write `claude_code_commands.rs` — Rust module for reading `~/.claude/`
   - Parse `history.jsonl` for session discovery
   - Parse session JSONL files into structured types
   - Read project `MEMORY.md` files
2. Register commands in `lib.rs`
3. Write TS wrappers in `src/lib/tauri/claudeCode.ts`
4. Write `claudeCodeStore.ts` — Zustand store for connector state
5. Create JSONL → `UnifiedSession` transformer

**Deliverable:** `useUnifiedSessions()` hook returns both Solo and Claude Code sessions.

### Phase 2: Session Viewer

**Goal:** Users can browse and read Claude Code sessions.

1. Session list UI — shows all sessions with source badge (`Solo` / `Claude Code`)
2. Session detail view — renders Claude Code JSONL as conversation
3. Tool call rendering — display tool uses and results inline
4. Thinking block rendering — show extended thinking (collapsed by default)
5. Project filtering — filter sessions by workspace path

### Phase 3: Memory & Context

**Goal:** Surface Claude Code's accumulated knowledge.

1. Read and display `MEMORY.md` per project
2. Read Claude Code `settings.json` — show plugins, MCP servers, permissions
3. Read `stats-cache.json` — show usage analytics dashboard
4. Read plans and tasks — show what the agent was working on

### Phase 4: Search & Analytics

**Goal:** Unified search across all sessions.

1. Full-text search across JSONL content
2. Filter by: project, model, date range, source
3. Usage analytics combining Solo + Claude Code stats
4. Session timeline visualization

### Phase 5: Advanced Integration

**Goal:** Deep integration features.

1. File history browser — show files Claude Code modified with diffs
2. Session resume from Claude Code — use SDK session IDs found in JSONL to resume
3. Watch `~/.claude/` for live updates (file system watcher)
4. Import Claude Code session into Solo format (for editing, annotating)

---

## 10. Format Translation: Claude Code → Solo

### JSONL → UnifiedSession

```
Input:  ~/.claude/projects/{path}/{uuid}.jsonl  (N lines)
Output: UnifiedSession { metadata, messages[] }
```

**Algorithm:**

```
1. Read all lines from JSONL file
2. Extract metadata from first `user` entry:
   - sessionId, cwd (→ projectPath), gitBranch, version, slug
3. Group `assistant` entries by `requestId` to reconstruct full messages
4. For each message group:
   a. Concatenate content blocks (thinking + text + tool_use)
   b. Find matching `user` entry with `tool_result` for tool outputs
   c. Extract `usage` from last assistant entry in group
5. Build message timeline:
   - user entries with string content → user messages
   - assistant entry groups → assistant messages with toolCalls
   - Skip: progress, queue-operation, system, file-history-snapshot
6. Compute metadata:
   - title: first user message content (truncated to 30 chars)
   - createdAt: timestamp of first user entry
   - lastActiveAt: timestamp of last entry
   - turnCount: count of system.turn_duration entries
   - totalTokens: sum of all usage.input_tokens + usage.output_tokens
   - messageCount: count of user + assistant messages
```

### Handling Subagents

Subagent sessions (in `subagents/agent-{id}.jsonl`) should be:
- Parsed the same way as main sessions
- Linked to parent session via `sessionId`
- Displayed as nested/collapsible in the UI

---

## 11. Edge Cases & Gotchas

### Format Stability

Claude Code's JSONL format is **undocumented and internal**. Anthropic can change it at any time without notice. Mitigations:
- **Version check:** Every entry has a `version` field (e.g., `"2.1.50"`). Use this to select parser variants.
- **Graceful degradation:** If an entry can't be parsed, skip it and show partial session.
- **Schema validation:** Don't crash on unknown fields — ignore them.

### Large Sessions

Some sessions can have 1,300+ JSONL entries. Mitigations:
- **Lazy loading:** Only parse metadata on initial scan, load full messages on demand.
- **Streaming parse:** Don't load entire JSONL into memory — stream line by line.
- **Cache parsed results:** Store transformed sessions in `~/.solo/connectors/claude-code/sessions-cache/`.

### Concurrent Access

Claude Code may be writing to a session JSONL while Solo is reading it. Mitigations:
- **Read-only:** Never write to `~/.claude/`.
- **Incomplete line handling:** Last line of JSONL may be truncated if session is active — catch JSON parse errors on last line.
- **No file locking:** JSONL is append-only so partial reads are safe (you just get fewer events).

### Path Encoding Ambiguity

The path-to-directory encoding (`/` → `-`) is lossy for paths containing dashes. Mitigations:
- Always use the `cwd` field from session entries for the actual project path.
- The encoded directory name is only for file discovery, not path reconstruction.

### Missing Sessions

`history.jsonl` may reference sessions whose JSONL files have been deleted. Mitigations:
- Verify file existence before listing a session.
- Show "session data unavailable" for missing files.

### SDK Session Resume

Claude Code sessions have an internal SDK session ID that could theoretically be used to resume them from Solo's bridge. However:
- This is undocumented behavior.
- The SDK session may have expired (sessions have TTLs).
- The bridge would need to support passing arbitrary SDK session IDs.
- **Recommendation:** Treat as a Phase 5 stretch goal, not a launch requirement.

### Thinking Signatures

Thinking blocks contain a `signature` field (base64-encoded). This is for Claude's chain-of-thought verification. Solo should:
- Display thinking content as-is.
- **Do not** attempt to validate or use the signature.
- Consider not storing signatures in cache (they're large and unnecessary).

### Token Usage Accuracy

Claude Code's `usage` fields per message may not include all costs (e.g., cache creation tokens). The `stats-cache.json` has more accurate aggregates. Use:
- Per-message `usage` for relative comparisons.
- `stats-cache.json` for aggregate analytics.

---

## 12. Things Not Yet Considered

### 12.1 Privacy & Security

- **Credentials:** `~/.claude/.credentials.json` contains API keys. Solo must NEVER read or cache this file.
- **Sensitive content:** Sessions may contain API keys, passwords, or secrets that were pasted into Claude Code. The connector should not index or search these without explicit user consent.
- **Multi-user:** What if multiple macOS users share a machine? `~/.claude/` is per-user, but Solo should verify ownership before reading.

### 12.2 Performance at Scale

- **933 sessions** currently stored in `~/.claude/`. As this grows to thousands, linear JSONL scanning becomes slow.
- Consider building a **SQLite index** in `~/.solo/connectors/claude-code/index.db` for fast queries.
- `history.jsonl` at 2.9 MB is still fast to parse, but at 10x size it needs pagination.

### 12.3 File System Watching

- Should Solo watch `~/.claude/` for real-time updates? (New sessions appearing, active sessions being written to)
- Tauri has `tauri-plugin-fs-watch` — could watch `~/.claude/projects/` and `~/.claude/history.jsonl`.
- Risk: High-frequency writes during active Claude Code sessions could flood the watcher.
- Recommendation: Poll-based sync (every 30-60 seconds) is safer than live watching for v1.

### 12.4 Claude Code Version Compatibility

- Claude Code updates frequently (currently at v2.1.50). Format changes are likely.
- Need a version compatibility matrix documenting which JSONL schemas map to which Claude Code versions.
- The `version` field in every entry enables per-version parsing.

### 12.5 Session Deduplication

- If a user starts a Claude Code session and then resumes it in Solo (via SDK session ID), we'd have:
  - The original JSONL in `~/.claude/`
  - The Solo v3 JSON in `~/.solo/`
  - These are the same logical session with different formats
- Need a deduplication strategy (probably based on `sdkSessionId` matching).

### 12.6 Non-Claude Agents (Future)

- The connector pattern should be generic enough to support future connectors:
  - VS Code Copilot sessions
  - Cursor AI sessions
  - Custom agent sessions from Solo's server mode
  - OpenAI ChatGPT-like interfaces
- The `UnifiedSession` type is intentionally provider-agnostic for this reason.

### 12.7 Data Export

- Users may want to export their session history (for backup, migration, or analysis).
- The connector should support exporting unified sessions to common formats (JSON, Markdown, CSV).

### 12.8 Offline / Missing `.claude/`

- What happens if `~/.claude/` doesn't exist? (User hasn't installed Claude Code)
- Solo should gracefully handle this: `claudeCodeAvailable: false` in store, no errors.
- What if `~/.claude/` exists but is empty or corrupted?
- Defensive parsing with per-file error handling.

### 12.9 Disk Space

- `~/.claude/` is already ~2.2 GB. If Solo caches parsed sessions in `~/.solo/connectors/`, that could add significant disk usage.
- Consider: only cache session metadata (not full messages) to keep cache small.
- Lazy-load full message content from the original JSONL on demand.

### 12.10 Plans & Tasks Naming

- Claude Code uses auto-generated slugs like `squishy-crafting-lovelace.md` for plans/tasks.
- These are not human-friendly. Solo should extract the actual content/title from the markdown.
- The markdown files may have structured headers that can be parsed for better display.

### 12.11 MCP Server Compatibility

- Claude Code's `settings.json` lists MCP servers with `command` and `args`.
- Solo could potentially connect to the same MCP servers for enhanced functionality.
- But: MCP server processes are singleton — if Claude Code is already running one, Solo can't start another on the same port.
- Recommendation: Read MCP config for display purposes only. Don't auto-start MCP servers.

### 12.12 Cross-Platform

- This design assumes macOS (`~/.claude/`). On Linux, the path is the same. On Windows, it's `%USERPROFILE%\.claude\`.
- Solo should use platform-appropriate paths: `dirs::home_dir()` in Rust + `.claude` appended.

### 12.13 Rate of Change Detection

- How does Solo know when `~/.claude/` has changed? Options:
  - **On-demand scan:** User clicks "refresh" or opens session browser
  - **Background poll:** Check `history.jsonl` mtime every N seconds
  - **File watcher:** Real-time notification of changes
- Recommendation: Start with on-demand + background poll (60s). Add watcher in Phase 5.

### 12.14 Permissions & Consent

- Should Solo ask the user for permission before reading `~/.claude/`?
- This is their own data on their own machine, but good practice is to:
  - Show a first-run dialog: "Solo can import your Claude Code sessions. Allow?"
  - Provide a setting to disable the connector
  - Never read silently without the user knowing

---

## 13. File & Directory Reference

### Files Solo Needs to Read from `~/.claude/`

| File/Directory | Priority | Purpose |
|---------------|----------|---------|
| `history.jsonl` | P0 | Session discovery index |
| `projects/{path}/{uuid}.jsonl` | P0 | Session conversations |
| `projects/{path}/memory/MEMORY.md` | P1 | Project memory/learnings |
| `settings.json` | P1 | User config, plugins, MCP servers |
| `stats-cache.json` | P2 | Usage analytics |
| `plans/{slug}.md` | P2 | Agent plans |
| `tasks/{slug}.md` | P2 | Agent tasks |
| `file-history/{uuid}/` | P3 | File change snapshots |
| `projects/{path}/{uuid}/subagents/` | P3 | Subagent sessions |
| `projects/{path}/{uuid}/tool-results/` | P3 | Large tool outputs |
| `shell-snapshots/` | P4 | Shell environment |
| `debug/` | P4 | Diagnostic logs (probably skip) |
| `paste-cache/` | P4 | Clipboard cache (probably skip) |

### Files Solo MUST NEVER Read

| File | Reason |
|------|--------|
| `.credentials.json` | Contains API keys — security risk |
| `backups/` | Internal state — not useful |

### New Files Solo Creates in `~/.solo/`

| File/Directory | Purpose |
|---------------|---------|
| `connectors/claude-code/index.json` | Cached session metadata index |
| `connectors/claude-code/last-sync.json` | Last sync timestamp |
| `connectors/claude-code/sessions-cache/` | Parsed session cache (optional) |

---

## Summary

**Decision:** Hybrid approach — Solo owns `~/.solo/`, reads `~/.claude/` as a connector.

**Why:** Full schema control for multi-agent future, zero corruption risk, immediate access to Claude Code history, and the "connector" pattern scales to any data source.

**Start with:** Phase 1 (JSONL parser + session discovery) → Phase 2 (UI) → expand from there.

**Key risk:** Claude Code's JSONL format is undocumented and may change. Mitigate with version-aware parsing and graceful degradation.
