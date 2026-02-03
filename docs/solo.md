# Solo

## What Solo Is

Solo is a desktop IDE built from scratch in Rust and React, designed so that AI agents operate as first-class participants in the development workflow — not bolted-on chat sidebars. It ships as a single native binary via Tauri, talks to multiple AI providers over streaming IPC, and keeps all project data local by default.

## The Problem

Developer tooling has not kept up with what AI agents need to be useful:

- **Fragmented AI integration.** Today's AI coding tools are plugins or wrappers around editors that were never designed for agent-driven workflows. The agent can suggest code, but it can't execute commands, read project context, or operate tools without awkward shims between the editor, a terminal, and an external API.

- **Electron bloat.** VS Code and its derivatives run on Electron, consuming 300–500 MB of RAM at idle. Every extension adds to the footprint. For an AI-native tool that needs to run model inference, maintain streaming connections, and manage PTY sessions simultaneously, this overhead is unacceptable.

- **No structured tool autonomy.** Agents need to read files, write files, run shell commands, and search codebases — but they need to do so within a permission model that the developer controls. Existing tools either give the agent no access or unconstrained access. There is no middle ground with approval workflows, scoped permissions, and auditable tool execution.

- **Single-provider lock-in.** Most AI coding tools are tied to one model provider. Developers want to use Claude for reasoning-heavy tasks, GPT-4.1 for large-context work, and switch freely without reconfiguring their environment.

## How Solo Solves It

Three principles define the architecture:

**AI-native.** The agent is not a panel — it is a peer process with structured access to the workspace. Solo defines a tool registry with five built-in tools (read_file, write_file, list_directory, bash, grep), each subject to an approval workflow. The agent can propose tool calls; the developer approves, rejects, or auto-approves by category. This creates a trust model that scales from exploratory chat to autonomous multi-step tasks.

**Rust-native.** The backend is a Cargo workspace of seven crates. File I/O, PTY management, code parsing, embedding search, and AI provider communication all run in Rust with async Tokio. The frontend is a React webview connected over Tauri's typed IPC bridge. Binary size is ~15 MB. Memory at idle is a fraction of Electron-based alternatives.

**Local-first.** Project files never leave the machine unless the developer explicitly sends a message to an AI provider. Credentials are stored in the macOS Keychain. There is no Solo cloud service, no telemetry endpoint, and no account required for local use. Authentication exists solely for optional features (currently GitHub OAuth via Supabase for user identity).

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                    Tauri Desktop App                      │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │              React Frontend (Webview)               │  │
│  │                                                    │  │
│  │   Zustand Stores ──── Hooks ──── Components        │  │
│  │        │                                           │  │
│  │   Tauri invoke() / listen()                        │  │
│  └────────────────┬───────────────────────────────────┘  │
│                   │ IPC (JSON, typed via solo-protocol)   │
│  ┌────────────────┴───────────────────────────────────┐  │
│  │              Rust Backend (Tokio async)              │  │
│  │                                                    │  │
│  │   41 registered Tauri commands across 7 modules:   │  │
│  │   agent · fs · terminal · parse · embeddings ·     │  │
│  │   auth · commands                                  │  │
│  │        │                                           │  │
│  │   Workspace crates:                                │  │
│  │   solo-agent · solo-fs · solo-core · solo-parse ·  │  │
│  │   solo-embeddings · solo-protocol                  │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### Crate Map

| Crate | Responsibility |
|-------|---------------|
| `solo-agent` | Multi-provider AI client (Anthropic, OpenAI), streaming, tool registry, session management, middleware pipeline, OAuth/PKCE |
| `solo-fs` | File CRUD, directory tree (lazy-loaded), file watching (notify + debounce), path traversal protection |
| `solo-core` | Shared error types, `Service` trait, configuration structs |
| `solo-parse` | Tree-sitter parsing for 7 languages, symbol extraction (functions, classes, methods, enums) |
| `solo-embeddings` | OpenAI embedding provider, in-memory vector index, cosine similarity search, code chunking |
| `solo-protocol` | All IPC message types with `serde` + `ts-rs` for TypeScript generation; single source of truth for the frontend/backend contract |

### IPC Model

- **Commands** (frontend → backend): Typed Tauri `invoke()` calls. 41 commands registered across agent, filesystem, terminal, parsing, embeddings, and auth modules.
- **Events** (backend → frontend): Tauri `emit()` for streaming data. The `BackendEvent` enum defines 15 event types covering agent streaming chunks, tool call lifecycle, terminal output, and file change notifications.
- **Type safety**: All request/response types are defined once in `solo-protocol` (Rust) and generated into TypeScript via `ts-rs`. No hand-written type duplication.

### Event Streaming

Agent responses and terminal output are streamed over Tauri events. A singleton listener pattern on the frontend prevents duplicate event registration across React renders. Events carry a session/conversation ID so a single listener can route data to the correct store slice in a multi-session architecture.

## Key System Design Decisions

### Tauri over Electron

Tauri 2.0 provides a native webview (WebKit on macOS) with a Rust backend, eliminating the bundled Chromium that makes Electron apps heavy. The security model is stricter by default — IPC commands must be explicitly registered, and capabilities are scoped per window. The tradeoff is less mature ecosystem and no cross-platform webview parity, but for a macOS-first product the tradeoff is favorable.

### Multi-Provider AI

The `AIProvider` trait abstracts over providers:

```rust
#[async_trait]
pub trait AIProvider: Send + Sync {
    fn provider_type(&self) -> ProviderType;
    async fn send_message(...) -> ProviderResult<mpsc::Receiver<BackendEvent>>;
    fn available_models(&self) -> Vec<String>;
    async fn validate_credentials(&self) -> ProviderResult<bool>;
    fn set_tools(&mut self, tools: Vec<ToolDefinition>);
}
```

Anthropic and OpenAI are implemented with provider-specific streaming protocols (SSE for Anthropic, delta-based chunks for OpenAI). Adding a new provider means implementing this trait. The `AgentManager` handles provider lifecycle, session routing, and credential validation.

**Supported models:** Claude Sonnet 4, Claude Opus 4, Claude 3.5 Haiku, GPT-4.1, GPT-4.1 Mini, o3, o4-mini, GPT-4o.

### Tool Approval Workflow

The agent's tool system distinguishes between tools that are safe to auto-execute and tools that require human approval. Each tool call goes through:

1. Agent proposes a tool call with parameters.
2. Frontend receives a `toolApprovalNeeded` event.
3. User approves or rejects.
4. If approved, the backend executes and returns the result to the agent's context.

This is not a convenience feature — it is the core trust mechanism that makes agent autonomy practical. Without it, users either refuse to let the agent act (limiting utility) or grant blanket access (creating risk).

### Workspace-Scoped Filesystem

All filesystem operations in `solo-fs` enforce workspace containment. Path traversal attempts (e.g., `../../etc/passwd`) are rejected before reaching the OS. The file watcher is scoped to the workspace root and respects `.gitignore` patterns. This means the agent's file tools can only operate within the project the user has opened.

### Credential Management

Credentials are resolved in priority order:

1. **macOS Keychain** — stored under service names like `solo.provider.anthropic.apiKey`
2. **Claude Code OAuth** — for Anthropic, reads existing credentials from Claude Code's keychain entry (if installed)
3. **Environment variables** — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`

No credentials are stored in config files or transmitted to Solo servers.

### Middleware Pipeline

The agent request/response cycle passes through a configurable middleware chain: logging, rate limiting, content guardrails, and metrics. This is implemented as a composable pipeline in Rust, not ad-hoc hooks. New middleware (e.g., cost tracking, PII filtering) can be added without modifying provider implementations.

## What's Built

| Subsystem | Status | Summary |
|-----------|--------|---------|
| **Agent** | Complete | Multi-provider streaming, 5 built-in tools, session management, approval workflows, middleware, telemetry, OAuth/PKCE for both providers |
| **Filesystem** | Complete | Secure CRUD, lazy directory tree, debounced file watching, path traversal protection |
| **Terminal** | Complete | Full PTY via `portable-pty`, shell auto-detection (zsh/bash/powershell), resize, signal handling, output streaming |
| **Parse** | Complete | Tree-sitter for Rust, TypeScript, JavaScript, Python, JSON, HTML, CSS, Markdown; symbol extraction with incremental parsing |
| **Embeddings** | Complete | OpenAI embedding models (text-embedding-3-small/large, ada-002), in-memory vector index, batch processing, code-specific chunking |
| **Auth** | Complete | Supabase GitHub OAuth with PKCE, macOS Keychain token storage, session refresh, magic link support |
| **Protocol** | Complete | Exhaustive IPC type definitions for all subsystems, TypeScript generation via ts-rs |
| **Core** | Minimal | Shared error types, Service trait, configuration. Serves as the cross-crate foundation rather than a feature crate. |

## What's Not Being Focused On Right Now

- **Editor engine / LSP.** No code editor is integrated yet. The choice between Monaco, CodeMirror, and a custom solution is deferred. LSP client implementation is not started. The current product thesis is that the AI agent and terminal are more valuable than a built-in editor for early users.

- **Plugin / extension system.** There is no mechanism for third-party extensions. The tool registry is internal. An extension model is a post-1.0 concern.

- **Cloud sync.** All data is local. There is no sync service, no shared workspace state, and no cloud storage. Authentication exists for user identity only, not for data persistence.

- **Collaboration.** Solo is a single-user tool. Real-time collaboration, shared sessions, and team features are not in scope.

- **Mobile / web.** Solo is a macOS desktop application. There is no web version, no iOS/Android target, and no plans to build one in the near term. Cross-platform (Linux, Windows) is possible via Tauri but not actively tested.

- **Auto-update / distribution.** There is no auto-update mechanism and no distribution pipeline (App Store, Homebrew, etc.). Builds are manual.

- **Monetization.** There is no pricing model, no license enforcement, and no usage metering. Users bring their own API keys.

## Open Questions

1. **Editor choice.** Monaco (VS Code's editor) has the richest feature set but brings significant bundle weight and an implicit dependency on VS Code's extension model. CodeMirror 6 is lighter and more composable but requires more integration work. A custom editor built on tree-sitter would be the most aligned with the Rust-native thesis but is a multi-year effort. This decision shapes the product more than any other.

2. **Extension model.** If Solo gains traction, users will want to extend it. The question is whether to build a VS Code-compatible extension host (maximizing ecosystem), a WASM-based plugin system (maximizing safety), or a simpler tool-definition format (minimizing complexity). Each has different implications for performance, security, and adoption.

3. **Pricing and sustainability.** Solo currently has no revenue model. Users provide their own AI API keys. Possible models include: a free open-source tool (community-supported), a paid desktop license (traditional), or a hosted service layer for team features (SaaS). The local-first architecture makes SaaS less natural but not impossible.

4. **Team features.** If Solo expands beyond individual developers, it needs shared context (project knowledge bases, conversation history, tool approval policies). This conflicts with the local-first principle and requires careful design to avoid becoming another cloud-dependent tool.

5. **Cross-platform parity.** Tauri uses platform-native webviews, which behave differently on macOS (WebKit), Windows (WebView2), and Linux (WebKitGTK). The auth subsystem uses macOS Keychain directly. Shipping on Windows and Linux requires abstracting credential storage and testing webview behavior on each platform.

6. **Agent autonomy levels.** The current approval workflow is binary (approve/reject per tool call). More sophisticated models are possible: auto-approve read-only tools, require approval for writes, allow full autonomy in sandboxed environments. The right default matters for user trust and agent utility.
