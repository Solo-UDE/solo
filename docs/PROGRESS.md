# Solo IDE — Progress Tracker

> **Last updated:** 2026-02-12

---

## Current Status: Core IDE Complete, Starting Feature Migration

The local IDE core is fully functional: terminal, editor, file explorer, AI agent with tool execution, auth, and settings. The next phase is git integration and then cloud features ported from the legacy codebase.

See `docs/MIGRATION.md` for the full migration plan.

---

## Phase 1: Foundation — COMPLETE ✅

- [x] Cargo workspace + Bun workspace
- [x] `solo-core` crate (traits, types, config)
- [x] `solo-protocol` crate with ts-rs TypeScript generation
- [x] Tauri 2 app structure
- [x] React 19 frontend with Vite
- [x] Tailwind CSS v4 with design tokens
- [x] `@solo/ui` shared component library

---

## Phase 2: Terminal — COMPLETE ✅

- [x] PTY spawning via `portable-pty` in `terminal_commands.rs`
- [x] UUID-based terminal sessions with `spawn_pty`, `write_pty`, `resize_pty`, `kill_pty`
- [x] Custom shell configs in `~/.solo/shell/` (zsh + bash with git prompt)
- [x] UTF-8 boundary handling for incomplete sequences
- [x] `TerminalView.tsx` — xterm.js v6 with fit + web-links addons
- [x] `SidebarTerminal.tsx` — bottom pane with tab bar, multi-terminal support
- [x] `useTerminalStream.ts` — singleton event listener for `terminal-event`
- [x] `terminalStore.ts` — Map-based Zustand store with Immer
- [x] Theme integration (dark/light mode, ResizeObserver)
- [x] Keyboard shortcut (Cmd+` toggle)
- [x] BackendEvent streaming (`TerminalData`, `TerminalExit`)

---

## Phase 3: File System — COMPLETE ✅

- [x] `solo-fs` crate — read, write, watch, tree operations
- [x] `fs_commands.rs` — Tauri commands (open_folder_dialog, read_directory, read_file, write_file, create_file, rename_file, delete_file, start_watching, stop_watching, reveal_in_finder)
- [x] File watcher with `notify` crate (100ms debounce)
- [x] Path validation (workspace containment)
- [x] `FileExplorer.tsx` + `FileTree.tsx` — tree view with icons
- [x] `CreationRow.tsx` — inline file/folder creation
- [x] Inline rename via `useInlineRename` hook
- [x] `fileExplorerStore.ts` — Zustand state for tree

---

## Phase 4: AI Agent — COMPLETE ✅

- [x] `solo-agent` crate — multi-provider agent engine
- [x] **Anthropic** provider — Claude Opus 4.5, Sonnet 4.5, Haiku 4.5 (OAuth + API key)
- [x] **OpenAI** provider — GPT-5.2 high/medium/low (OAuth + API key)
- [x] **Gemini** provider — Gemini 3 pro/flash (API key)
- [x] Agentic loop (25-turn max, tool approval with oneshot channels)
- [x] Tool framework: BashTool, GlobTool, GrepTool, ReadFileTool, WriteFileTool, EditFileTool, ListFilesTool
- [x] Tool sandboxing (path containment)
- [x] System prompt generation (`system_prompt.rs`)
- [x] `agent_commands.rs` — session CRUD, send message, abort, model switching, OAuth, Claude CLI
- [x] `AgentWindow.tsx` — chat UI with streaming, code blocks, tool approval
- [x] Session persistence (LocalStorage)
- [x] Context tracker component
- [x] Provider logos (Anthropic, Claude, OpenAI, Gemini SVGs)

---

## Phase 5: Code Editor — COMPLETE ✅

- [x] Monaco Editor integration (`@monaco-editor/react`)
- [x] Multi-tab editing with unsaved indicator
- [x] Autosave on blur and tab switch (`useAutosave`)
- [x] Solo theme (dark + light)
- [x] Symbol outline via `solo-parse` (tree-sitter)
- [x] Breadcrumb navigation
- [x] Markdown preview with split pane + synced scroll
- [x] Editor settings (font, tab size, word wrap, minimap, line numbers)

---

## Phase 6: Auth & Settings — COMPLETE ✅

- [x] Supabase OAuth (PKCE flow) + magic links
- [x] Deep linking for OAuth callback (`soloide://auth/callback`)
- [x] Keychain storage (macOS)
- [x] Token refresh
- [x] `AuthGuard` + `LoginScreen` components
- [x] Settings modal (5 tabs: General, Editor, Files, Shortcuts, AI)
- [x] Provider management (OAuth sign-in, API key entry, model selection)
- [x] Keyboard shortcut customization

---

## Phase 7: Layout & Polish — COMPLETE ✅

- [x] Mosaic panel system (react-mosaic-component)
- [x] Panel registry with extensible panel types
- [x] Collapsible left sidebar (drag to resize, double-click to reset)
- [x] Resizable terminal bottom pane (120-600px)
- [x] macOS vibrancy + traffic light positioning (tauri-plugin-decorum)
- [x] Phosphor icons
- [x] Color scheme toggle (dark/light)
- [x] Drag-and-drop tab reordering

---

## Phase 8: Git Integration — COMPLETE ✅

- [x] `git_commands.rs` — 16 commands using `git2` crate
- [x] Git status, diff, changes, stage/unstage, commit, push, pull, discard, branch
- [x] Source control sidebar UI with staged/unstaged sections
- [x] `gitStore.ts` Zustand store with 5s polling
- [x] `src/lib/tauri/git.ts` IPC wrappers
- [x] Git diff panel with Monaco DiffEditor
- [x] GitHub REST API client, setup flow
- [x] Branch selector with inline create branch

### Phase 8.5: Git Fixes & Enhancements — COMPLETE ✅

- [x] Fixed `git_push` auto-commit leak — push no longer silently commits staged changes
- [x] Commit/push fully separated — commit creates local commit, push only pushes existing commits
- [x] `git_push` `commit_message` now `Option<String>` (used only for synthetic/orphan commits)
- [x] `git_commit` now calls `cleanup_git_locks` for stale lock file recovery
- [x] `commits_ahead` added to `GitRepoStatus` — revwalk count of local commits ahead of remote
- [x] Push button shows badge with commits ahead count, disabled when nothing to push
- [x] `git_create_branch` command — validates name, creates from HEAD, checks out
- [x] Branch selector has inline create branch UI (+ icon, input, spinner, error)
- [x] Store: removed redundant `commitMessage` clear from `push()`, added `commitsAhead` + `isCreatingBranch`
- [x] Created `docs/GIT_FEATURES.md` — comprehensive git feature documentation

---

## Phase 9: Feature Migration — PLANNED 📋

> See `docs/MIGRATION.md` for the complete migration plan

### Priority 1 (Local features)
- [ ] Git integration (Phase 8 above)
- [ ] Checkpoint system
- [ ] System checker

### Priority 2 (Cloud infrastructure)
- [ ] Solo Server (cloud backend)
- [ ] Project management (create, import, clone, templates)
- [ ] Chat persistence (server-side sessions + messages)

### Priority 3 (Deployment & integrations)
- [ ] Vercel deployment
- [ ] GitHub App integration
- [ ] Supabase provisioning

### Priority 4 (Advanced features)
- [ ] Stripe payments & billing
- [ ] App preview (embedded browser)
- [ ] Mobile builds (EAS)
- [ ] Server-side agents (design, database, etc.)
- [ ] Screen recording
- [ ] Auto-updater
- [ ] Analytics

---

## Session Log

### 2026-01-25
- Initial architecture planning
- Phase 1 Foundation implemented

### 2026-02-03
- Terminal implementation (dev branch)
- Vibrancy and phosphor icons
- Agentic loop with unified tool calling
- Gemini provider added
- OAuth improvements

### 2026-02-11
- Phase 2a terminal implementation (master branch)
- Merged dev branch into master (resolved 9 conflicts)
- Dev branch terminal architecture adopted (UUID IDs, SidebarTerminal, TerminalView)
- Created MIGRATION.md documenting full migration port plan
- Updated PROGRESS.md to reflect current state

### 2026-02-12
- Phase 8: Git Integration implemented
  - `git2` Rust crate for native git operations (no shell dependency)
  - 10 Tauri commands: status, setup, push, pull, changes, diff, discard, cleanup
  - 11 Git protocol types in solo-protocol + 2 BackendEvent variants
  - TypeScript IPC wrappers, Zustand gitStore with 5s polling
  - Source Control sidebar tab with branch selector, commit UI, file change list
  - Git diff panel with Monaco DiffEditor (side-by-side)
  - GitHub REST API client, accounts store, repo setup flow
  - Confirm dialog for destructive operations (discard file/all)

### 2026-02-14
- Phase 8.5: Git Fixes & Enhancements
  - Fixed push auto-commit leak (push no longer creates silent commits)
  - Commit/push fully separated, commit_message optional on push
  - Added cleanup_git_locks to git_commit
  - Added commits_ahead (revwalk) to GitRepoStatus
  - Push button: badge count, disabled when nothing to push
  - git_create_branch command with validation + checkout
  - BranchSelector: inline create branch UI
  - Created docs/GIT_FEATURES.md
