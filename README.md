# Solo IDE

A native desktop IDE built on Rust and Tauri 2 with an integrated AI agent, designed for speed, privacy, and a unified development experience.

## Overview

Solo is a from-scratch desktop IDE that replaces the Electron model with a Rust-powered backend and a React 19 frontend. It ships a full development environment -- code editor, terminal, file explorer, git, and an AI agent -- in a single native window with minimal resource usage.

## License

This project is licensed under a custom Source Available - Evaluation Only license. You may view and read the source code, but copying, modification, distribution, derivative works, and commercial use are prohibited. See [LICENSE](./LICENSE) for full terms.

## Why Solo

### Native Performance Over Electron
Rust + Tauri 2 backend. Async I/O with zero UI blocking. macOS vibrancy and platform-native window controls.

### Agent-First, Not Copilot-Bolted
Anthropic-first coding agent built into the core. OpenAI and Gemini sessions are chat-only, not tool-running agent sessions. Tool approval workflows, plan mode, and accept mode are owned by Solo and enforced through the sidecar runtime.

### All-in-One Workspace
Monaco editor, multi-tab terminal, file explorer, and source control in a tiled panel layout. Native git via libgit2. Tree-sitter parsing and semantic code search.

### Local-First, Privacy by Default
Runs entirely on your machine with no telemetry. API keys stored in the OS keychain. Workspace file access is sandboxed and path-validated.

## Architecture

Solo is a monorepo with Cargo and Bun workspaces. The Rust backend handles all system operations (file I/O, git, terminal PTY, auth) and communicates with the React frontend through Tauri's typed IPC bridge. The AI agent runs as an isolated Node.js sidecar process, communicating with the backend over stdin/stdout JSON.

```
Frontend (React 19)  <--Tauri IPC-->  Backend (Rust)  <--stdin/stdout-->  Agent Bridge (Node.js)
```

All IPC types are defined once in Rust (`solo-protocol`) and auto-generated into TypeScript via `ts-rs`, ensuring type safety across the boundary.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop Framework | Tauri 2 |
| Backend | Rust (2021 edition), Tokio |
| Frontend | React 19, TypeScript, Vite 6 |
| Styling | Tailwind CSS 4 |
| State Management | Zustand 5 + Immer |
| Code Editor | Monaco Editor |
| Terminal | xterm.js 6 + portable-pty |
| Git | libgit2 (git2 crate) |
| Code Parsing | Tree-sitter (8 languages) |
| Auth | OAuth 2.0 PKCE, macOS Keychain |
| AI Providers | Anthropic agent runtime, OpenAI/Gemini chat |

## Features

- **Code Editor** -- Monaco-based with multi-tab support, symbol outline, and markdown preview
- **Terminal** -- Multi-session PTY terminals with xterm.js, custom shell configs
- **File Explorer** -- Tree view with file watching, inline create/rename, Finder reveal
- **AI Agent** -- Anthropic-backed agent loop with tool approval, plan mode, accept mode, MCP, skills, and session persistence metadata
- **Git Integration** -- Staging, diffing, branching, push/pull, and worktree support via native libgit2
- **Code Intelligence** -- Tree-sitter parsing across Rust, TypeScript, JavaScript, Python, JSON, HTML, CSS, Markdown
- **Semantic Search** -- Vector embeddings for RAG-powered code search
- **Speech I/O** -- Speech-to-text and text-to-speech via ElevenLabs integration
- **Auth** -- OAuth with PKCE, magic links, multi-provider credential management
- **Settings** -- Configurable editor, keybindings, theme, and AI preferences
- **Tiled Panels** -- Mosaic-based panel layout with drag-reorder tabs and split views

## Getting Started

### Prerequisites

- macOS 10.15+
- Rust (stable toolchain)
- Bun >= 1.1
- Node.js >= 20

### Install

```bash
git clone https://github.com/Solo-UDE/solo.git
cd solo
bun install
```

### Development

```bash
bun run dev          # Full Tauri dev mode with hot reload
bun run check        # Cargo check + TypeScript typecheck
bun run test         # Cargo test + frontend tests
bun run build        # Production build
```

## Project Structure

```
solo/
├── crates/
│   ├── solo-core/          # Core traits, types, error handling
│   ├── solo-protocol/      # IPC types (generates TS bindings via ts-rs)
│   ├── solo-fs/            # File system operations and watchers
│   ├── solo-git/           # Git operations via libgit2
│   ├── solo-auth/          # OAuth, keychain, credential management
│   ├── solo-parse/         # Tree-sitter code parsing
│   ├── solo-embeddings/    # Vector embeddings for semantic search
│   └── solo-elevenlabs/    # Speech-to-text and text-to-speech
├── apps/
│   └── desktop/
│       ├── src-tauri/      # Rust backend (Tauri commands, state, IPC)
│       └── src/            # React frontend (components, stores, hooks)
├── packages/
│   └── ui/                 # Shared React component library (@solo/ui)
├── agent-bridge/           # Node.js sidecar for AI agent execution
└── docs/                   # Architecture, decisions, and progress docs
```

## Team

- **Sachin Adlakha**
- **Tanish Rana**
- **Adamay Mann**
