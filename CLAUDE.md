# Solo IDE

Tauri 2 desktop IDE — Rust backend, React 19 frontend, monorepo with Cargo + Bun workspaces.

## Commands
- `bun run dev` — full Tauri dev mode with hot reload
- `bun run build` — production build (Vite + cargo release)
- `bun run check` — cargo check + TypeScript typecheck
- `bun run test` — cargo test + frontend tests
- `bun run gen:bindings` — regenerate TypeScript bindings from Rust types (ts-rs)
- `cargo clippy --workspace -- -D warnings` — Rust linting (pedantic, must pass clean)
- `cargo fmt --all` — Rust formatting
- `cargo test --workspace --lib` — run inline unit tests

## Package Manager
Always use `bun` (not npm/yarn/pnpm). The lockfile is `bun.lock`.

## Monorepo Layout
- `crates/` — Rust libraries (solo-core, solo-protocol, solo-fs, solo-agent, solo-parse, solo-embeddings)
- `apps/desktop/src-tauri/src/` — Tauri Rust commands (*_commands.rs)
- `apps/desktop/src/` — React frontend
- `packages/ui/` — Shared React component library (@solo/ui)

## IPC Pattern (the critical architecture)
All frontend-backend communication goes through Tauri's IPC bridge:

1. **Rust command**: `#[tauri::command]` fn in `*_commands.rs`, registered in `lib.rs` via `generate_handler!`
2. **TypeScript wrapper**: type-safe `invoke()` call in `src/lib/tauri/*.ts`
3. **Backend->Frontend streaming**: `app_handle.emit("backend-event", &BackendEvent::Variant { ... })`
4. **Frontend listener**: `listen("backend-event", handler)` in `src/hooks/use*Stream.ts`

When adding a new command: define types in `solo-protocol`, write the command fn, register in `lib.rs`, run `bun run gen:bindings`, write the TS wrapper.

## Type Bindings (ts-rs)
- All IPC types live in `crates/solo-protocol/src/lib.rs`
- Derive `ts_rs::TS` + `serde::Serialize/Deserialize`
- Run `bun run gen:bindings` after changing protocol types
- Generated TS files go to `apps/desktop/src/bindings/`
- NEVER hand-edit files in `src/bindings/` — they are auto-generated

## State Management
- **Rust**: Each domain has a `*State` struct with `RwLock<HashMap<...>>`, managed via `.manage()` in lib.rs
- **React**: Zustand stores with Immer middleware. Use `Map` for O(1) lookups, `Set` for collections.

## Conventions
- One `*_commands.rs` file per domain (fs, terminal, agent, auth, parse, embedding)
- Matching `src/lib/tauri/*.ts` wrapper per command file
- Matching `src/stores/*Store.ts` per domain
- Matching `src/hooks/use*Stream.ts` for event listeners
- Panel components in `src/components/panels/`
- Path alias: `@/*` maps to `./src/*`

## Gotchas
- `BackendEvent` is a tagged union (`#[serde(tag = "type")]`) — the `type` field is the discriminant
- Tauri commands return `Result<T, String>` — convert domain errors to String at the boundary
- File watcher events are debounced (100ms) — don't expect per-keystroke updates
- PTY spawning uses `portable-pty` — test on macOS, behavior differs on Windows
- OAuth auth uses a local Hyper callback server — port conflicts possible in dev
- `tauri::generate_context!()` panics under plain `cargo clippy` — exclude `solo-desktop` or use `cargo tauri dev`

---

## Error Handling Patterns

Two-tier system: typed domain errors internally, string/structured errors at the IPC boundary.

**Domain errors** — each crate defines its own error enum with `thiserror`:
- `SoloError` (solo-core), `FsError` (solo-fs), `ProviderError` (solo-agent)
- `ParserError` (solo-parse), `EmbeddingError` (solo-embeddings)
- Use `#[from]` for automatic conversion from source errors (e.g., `#[from] std::io::Error`)

```rust
#[derive(thiserror::Error, Debug)]
pub enum FsError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Path not in workspace: {0}")]
    OutsideWorkspace(PathBuf),
}
```

**IPC boundary** — Tauri commands convert to `Result<T, String>`:
```rust
#[tauri::command]
async fn read_file(path: String) -> Result<String, String> {
    operations::read_file(&path).map_err(|e| e.to_string())
}
```

For structured errors the frontend can match on, use a serializable error type (e.g., `FileOperationError`).

**Rules:**
- `anyhow` is in `Cargo.toml` but NOT used — all errors must be typed
- Never use `.unwrap()` in command handlers — always propagate with `?`
- Pattern: define error enum → `#[from]` for common sources → `.map_err(|e| e.to_string())` at boundary

---

## Async Runtime

Tokio 1.43 with `features = ["full"]`. Tauri manages the runtime — no `#[tokio::main]` needed.

**Key patterns:**
- `async-trait` required for all async trait methods (`AIProvider`, `EmbeddingProvider`)
- **Cancellation**: `tokio::sync::watch::channel(false)` — stored in `AgentState.abort_senders`
- **Tool approval**: `tokio::sync::oneshot` — stored in `AgentState.loop_approvals`
- **Racing**: `tokio::select!` for abort/timeout/approval

```rust
tokio::select! {
    result = do_work() => handle_result(result),
    _ = abort_rx.changed() => return Err("Aborted".into()),
}
```

**Exception:** PTY code (`terminal_commands.rs`) uses `std::thread::spawn` + `std::sync` primitives because `portable-pty` is a blocking C library. Never mix `tokio::sync` into PTY code.

---

## Memory Management Rules

- `tokio::sync::RwLock` for all async Tauri command state
- `std::sync::{RwLock, Mutex}` ONLY for PTY/blocking thread code in `terminal_commands.rs`
- `Arc<T>` for sharing state across `tokio::spawn` closures
- `Arc<RwLock<T>>` double-wrap for spawned task sharing

**Critical rule:** Never hold async lock guards across `.await` — clone/drop first:
```rust
// WRONG — holds lock across await
let guard = state.read().await;
do_async_work(&guard).await;

// RIGHT — clone then drop
let data = state.read().await.clone();
do_async_work(&data).await;
```

Shared workspace root pattern: `SharedWorkspaceRoot = Arc<RwLock<Option<PathBuf>>>`

---

## Serde Conventions

- **Internally tagged**: `#[serde(tag = "type")]` for `ContentBlock`
- **Adjacently tagged**: `#[serde(tag = "type", content = "payload")]` for `BackendEvent`
- **Enum casing**: `rename_all = "snake_case"` or `"lowercase"`
- **Optional fields**: `skip_serializing_if = "Option::is_none"` / `"Vec::is_empty"`
- **Secrets**: `#[serde(skip_serializing)]` for `api_key` fields
- **Event names**: colon-namespaced (`"terminal:data"`, `"agent:chunk"`)

```rust
#[derive(Serialize, Deserialize, TS)]
#[serde(tag = "type", content = "payload")]
pub enum BackendEvent {
    #[serde(rename = "terminal:data")]
    TerminalData { session_id: String, data: String },
}
```

---

## Testing Conventions

- **Inline tests only**: `#[cfg(test)] mod tests { ... }` at the bottom of each file
- `#[tokio::test]` for async tests, `#[test]` for sync
- `tempfile::TempDir` for filesystem tests
- `matches!()` for error variant assertions
- No mocking libraries — test pure logic, not network calls

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_conversion() {
        let err = FsError::OutsideWorkspace("/tmp".into());
        assert!(matches!(err, FsError::OutsideWorkspace(_)));
    }
}
```

---

## Logging

`tracing` + `tracing-subscriber` with `EnvFilter`.

```rust
use tracing::{debug, info, warn, error};

info!(session_id = %id, turn, "Processing agent turn");
debug!(?config, "Loaded configuration");
error!(error = %e, "Failed to read file");
```

- `%` for Display, `?` for Debug, bare names for Copy types
- Default filter: `solo_desktop=debug,tauri=info`
- Import only the macros you use — unused `tracing` imports trigger clippy errors

---

## Clippy Configuration

All crates use `#![warn(clippy::all, clippy::pedantic)]` with a curated set of allows. See any `lib.rs` for the full list.

**Key allows and rationale:**
| Allow | Reason |
|-------|--------|
| `module_name_repetitions` | `FsError` in `solo_fs` is idiomatic |
| `must_use_candidate` | Very noisy with pedantic on pure functions |
| `missing_errors_doc` / `missing_panics_doc` | Aspirational — hundreds of warnings day one |
| `cast_precision_loss` / `cast_sign_loss` | Safe in context (timestamps, metrics, tree-sitter) |
| `too_many_arguments` (desktop only) | Tauri commands have AppHandle + State + params |
| `needless_pass_by_value` (desktop only) | Tauri deserializes owned types from JSON |

**Thresholds** in `clippy.toml`:
- `cognitive-complexity-threshold = 30` (agentic loops are complex)
- `too-many-lines-threshold = 120`
- `too-many-arguments-threshold = 9`

Run: `cargo clippy --workspace --exclude solo-desktop -- -D warnings`
(Desktop crate excluded because `tauri::generate_context!()` needs the Tauri build pipeline.)

---

## AI Workflow

When writing Rust code for Solo, follow this order:

1. **Types first** — define protocol types in `solo-protocol` if IPC is involved
2. **Traits** — define behavior contracts before implementation
3. **Implementation** — write the command/function
4. **Tests** — add inline `#[cfg(test)]` tests
5. **Verify** — run these before considering work done:
   ```sh
   cargo check --workspace
   cargo clippy --workspace --exclude solo-desktop -- -D warnings
   cargo fmt --all -- --check
   cargo test --workspace --lib --exclude solo-desktop
   ```
6. **Bindings** — run `bun run gen:bindings` if protocol types changed
7. **Never** hand-edit files in `src/bindings/`

---

## Docs
- `docs/ARCHITECTURE.md` — system design and component overview
- `docs/DECISIONS.md` — architectural decision log with rationale
- `docs/PROGRESS.md` — implementation phase tracker
