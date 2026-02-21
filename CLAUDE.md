# Solo IDE

Tauri 2 desktop IDE — Rust backend, React 19 frontend, monorepo with Cargo + Bun workspaces.

## Commands
- `bun run dev` — full Tauri dev mode with hot reload
- `bun run build` — production build (Vite + cargo release)
- `bun run check` — cargo check + TypeScript typecheck
- `bun run test` — cargo test + frontend tests
- `bun run gen:bindings` — regenerate TypeScript bindings from Rust types (ts-rs)
- `cargo clippy --workspace` — Rust linting
- `cargo fmt --all` — Rust formatting

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

## Docs
- `docs/ARCHITECTURE.md` — system design and component overview
- `docs/DECISIONS.md` — architectural decision log with rationale
- `docs/PROGRESS.md` — implementation phase tracker
- `docs/MIGRATION.md` — feature migration plan and priority tiers

## Migration Context

Solo is migrating features from the legacy Electron app. Phases 1-7 are complete (terminal, file explorer, AI agent, code editor, auth, settings, layout). Phase 8 (Git Integration) is in progress.

## Branding Policy

**STRICT: Never reference the legacy Electron product name anywhere in this codebase.** This includes:
- Code comments, JSDoc, file headers
- Commit messages, PR descriptions
- Documentation, READMEs, changelogs
- Variable names, string literals, git refs
- Agent system prompts or user-facing text

Use "Solo" or "the legacy codebase" / "the reference codebase" if historical context is needed.

### Skills

| Skill | Purpose | Location |
|-------|---------|----------|
| `solo-migration` | Migration status, translation rules, pitfalls | `.claude/skills/solo-migration-skill/` |
| `solo-tauri-commands` | Templates for new command modules | `.claude/skills/solo-tauri-commands-skill/` |
| `solo-ui` | UI design system, component patterns | `.claude/skills/solo-ui-skill/` |

### Adding a New Domain (Quick Reference)

1. Protocol types in `crates/solo-protocol/src/lib.rs`
2. BackendEvent variants (if streaming)
3. `bun run gen:bindings`
4. `{domain}_commands.rs` in `apps/desktop/src-tauri/src/`
5. Register in `lib.rs`: `mod` + `use` + `.manage()` + `generate_handler![]`
6. TS wrapper in `apps/desktop/src/lib/tauri/{domain}.ts`
7. Zustand store in `apps/desktop/src/stores/{domain}Store.ts`
8. UI components in `apps/desktop/src/components/{domain}/`

Full 16-step checklist: `.claude/skills/solo-tauri-commands-skill/new-domain-checklist.md`
