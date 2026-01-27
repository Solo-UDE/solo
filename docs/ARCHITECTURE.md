# Solo IDE - Architecture Overview

## Vision

A Rust-based IDE with AI-first capabilities, inspired by Orbit IDE's patterns but built from the ground up with Rust performance and safety.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Tauri Desktop App                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                   React Frontend (Webview)                 │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐ │  │
│  │  │ Terminal │ │  Editor  │ │ AI Chat  │ │ File Explorer│ │  │
│  │  │ (xterm)  │ │(CodeMirr)│ │(Messages)│ │    (Tree)    │ │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘ │  │
│  │                      Zustand Stores                       │  │
│  │                      Tauri Bridge                         │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              ↕ IPC                               │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                   Rust Backend (Tauri Core)                │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐ │  │
│  │  │ Terminal │ │  Editor  │ │    AI    │ │  Filesystem  │ │  │
│  │  │ Service  │ │ Service  │ │ Service  │ │   Service    │ │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘ │  │
│  │                      App State (tokio)                    │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Monorepo Structure

```
solo/
├── Cargo.toml                    # Workspace root
├── rust-toolchain.toml           # Pin Rust version (1.75+)
├── package.json                  # Bun workspace root
├── bun.lockb
│
├── crates/                       # Rust crates
│   ├── solo-core/                # Core traits, types, errors
│   ├── solo-protocol/            # IPC protocol (generates TS types)
│   ├── solo-terminal/            # PTY management (portable-pty)
│   ├── solo-fs/                  # Filesystem ops, watchers
│   ├── solo-ai/                  # Claude API client
│   └── solo-editor/              # Editor engine (future)
│
├── apps/
│   └── desktop/                  # Tauri desktop app
│       ├── src-tauri/            # Rust Tauri code
│       │   ├── Cargo.toml
│       │   ├── tauri.conf.json
│       │   └── src/
│       │       ├── main.rs
│       │       ├── commands/     # IPC command handlers
│       │       ├── events/       # Event emitters
│       │       └── state/        # App state
│       └── src/                  # React frontend
│           ├── App.tsx
│           ├── components/
│           ├── stores/           # Zustand
│           ├── hooks/
│           └── lib/tauri.ts      # Tauri invoke wrappers
│
├── packages/                     # Shared TypeScript
│   ├── ui/                       # Shared React components
│   └── protocol/                 # Generated TS types from Rust
│
├── tools/
│   └── scripts/                  # Build scripts
│
└── docs/                         # Documentation
    ├── DECISIONS.md              # Decision log
    ├── ARCHITECTURE.md           # This file
    └── PROGRESS.md               # Implementation progress
```

---

## Crate Responsibilities

### `solo-core`
- Core traits (`Service`, `Disposable`)
- Event system (broadcast channels)
- Error types (`thiserror`)
- Shared utilities

### `solo-protocol`
- All IPC message types
- Serde serialization
- TypeScript generation via `ts-rs`
- Single source of truth for frontend/backend contract

### `solo-terminal`
- PTY spawning via `portable-pty`
- Shell integration
- Flow control (backpressure handling)
- Signal handling (Ctrl+C, etc.)

### `solo-fs`
- File read/write operations
- Directory listing/tree building
- File watching via `notify`
- Glob pattern matching

### `solo-ai`
- Anthropic API client
- Streaming response handling
- Tool definition & execution
- Session/conversation management

---

## IPC Design

### Commands (Frontend → Backend)
```rust
#[tauri::command]
async fn terminal_create(request: TerminalCreateRequest) -> Result<String, String>
```

### Events (Backend → Frontend)
```rust
app.emit("backend-event", BackendEvent::TerminalData { ... })
```

### Protocol Types
All types defined in `solo-protocol` crate with:
- `serde::Serialize` + `serde::Deserialize` for JSON
- `ts_rs::TS` for TypeScript generation

---

## UI Design Principles

Following Orbit-web's warm aesthetic:

1. **Shadows over borders** - Soft elevation, no hard 1px lines
2. **OKLCH colors** - Warm, organic palette
3. **Spring animations** - `cubic-bezier(0.34, 1.56, 0.64, 1)`
4. **Generous spacing** - Breathing room between elements
5. **Glassmorphism** - `backdrop-blur` on floating panels

### Key Tokensgiiuguiohuihohghyjgyi
- Button height: 34-40px
- Border radius: 8-14px
- Transitions: 150-200ms
- Hover scale: 1.02-1.05jhkgliguigluglouoh'hp

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Desktop Framework | Tauri 2.0 |
| Backend Language | Rust |
| Frontend Framework | React 19 |
| Styling | Tailwind CSS v4 |
| State Management | Zustand |
| Terminal | xterm.js + portable-pty |
| AI Integration | Anthropic API (direct) |
| Build (Rust) | Cargo |
| Build (JS) | Bun + Vite |

---

## References

- Orbit IDE: `/Orbit/claude.md`
- Orbit-web UI: `/Orbit-web/components/`
- Orchids Desktop AI: `/orchids/desktop/src/`
- UI Skill: `/.claude/skills/orbit-ui-skill/`
