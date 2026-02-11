# Orchids → Solo Migration Guide

> **Last updated:** 2026-02-11
> **Purpose:** Track what needs to be ported from the Orchids (Electron) codebase into Solo (Tauri).

---

## Strategy

**Hybrid approach:** React components port almost directly (swap `window.App.*` → `invoke()`). Electron main-process handlers get rewritten as Tauri Rust commands. The Orchids server gets forked, rebranded, and given fresh credentials.

```
Orchids Desktop (Electron)     →  Solo Desktop (Tauri)
├── React components (166)     →  Port to solo/apps/desktop/src/
├── Zustand stores (17)        →  Merge with solo's stores
├── Hooks (30+)                →  Port (swap electron IPC → tauri invoke)
├── Main process handlers (28) →  Rewrite as Tauri Rust commands
└── Preload bridge (40+ APIs)  →  Replace with Tauri command system

Orchids Server (Hono)          →  Solo Server (new repo)
├── 24 route files             →  Fork, rebrand, new credentials
├── 10 agent types             →  Port as-is
├── Database schema            →  Fresh Supabase project
└── Third-party integrations   →  New accounts for each
```

---

## What Solo Already Has (DONE)

| Feature | Status | Key Files |
|---------|--------|-----------|
| **Terminal** | ✅ Complete | `terminal_commands.rs`, `TerminalView.tsx`, `SidebarTerminal.tsx`, `useTerminalStream.ts` |
| **AI Agent** | ✅ Complete | `agent_commands.rs`, `solo-agent/`, `AgentWindow.tsx`, 3 providers (Anthropic/OpenAI/Gemini) |
| **Agentic Loop** | ✅ Complete | 25-turn max, tool approval, auto-loop on tool calls |
| **Agent Tools** | ✅ Complete | BashTool, GlobTool, GrepTool, ReadFileTool, WriteFileTool, EditFileTool, ListFilesTool |
| **File Explorer** | ✅ Complete | `fs_commands.rs`, `FileExplorer.tsx`, file watching, inline rename, creation row |
| **Code Editor** | ✅ Complete | Monaco integration, multi-tab, markdown preview, symbol navigation |
| **Auth** | ✅ Complete | Supabase OAuth + magic links, keychain storage, deep linking (`soloide://`) |
| **Settings** | ✅ Complete | 5 tabs: General, Editor, Files, Shortcuts, AI |
| **Layout** | ✅ Complete | Sidebar, mosaic panels, resizable terminal pane, macOS vibrancy |
| **Parsing** | ✅ Complete | Tree-sitter via `solo-parse`, 30+ languages, breadcrumbs |
| **Embeddings** | ✅ Complete | `solo-embeddings` crate, semantic code search |

---

## What Needs to Be Ported

### Priority 1 — Core IDE Features (Local, No Server)

#### 1A. Git Integration
**Orchids source:** `desktop/src/main/git-handler.ts` (34KB), `git-sync-handler.ts` (27KB), `source-control-sidebar.tsx` (56KB)

| Task | Solo Target | Reference |
|------|-------------|-----------|
| Create `git_commands.rs` using `git2` crate or git CLI | `src-tauri/src/git_commands.rs` | `git-handler.ts` |
| Git status (staged, unstaged, untracked) | Rust command | `git-handler.ts:getStatus` |
| Git diff (file-level and hunk-level) | Rust command | `git-handler.ts:getDiff` |
| Git commit (message, staged files) | Rust command | `git-handler.ts:commit` |
| Git push/pull (with auth) | Rust command | `git-handler.ts:push/pull` |
| Git branch (create, switch, delete, list) | Rust command | `git-handler.ts:branch*` |
| Git log (commit history) | Rust command | `git-handler.ts:getLog` |
| Git init / clone | Rust command | `git-handler.ts:init/clone` |
| Source control sidebar UI | `src/components/sidebar/SourceControl.tsx` | `source-control-sidebar.tsx` |
| Git store (Zustand) | `src/stores/gitStore.ts` | `desktop/src/renderer/stores/sync.ts` |
| TS IPC wrappers | `src/lib/tauri/git.ts` | — |

**Dependencies:** `git2` crate (or shell out to git CLI)

#### 1B. Checkpoint System
**Orchids source:** `desktop/src/main/checkpoint-handler.ts`, `checkpoint-system.ts` (18KB), `server/src/routes/checkpoint-routes.ts`

| Task | Solo Target | Reference |
|------|-------------|-----------|
| Checkpoint save (snapshot project state) | `src-tauri/src/checkpoint_commands.rs` | `checkpoint-system.ts` |
| Checkpoint restore (rollback to snapshot) | Rust command | `checkpoint-handler.ts` |
| Checkpoint list/delete | Rust command | — |
| Checkpoint UI (restore dialog) | `src/components/` | `restore-checkpoint-dialog.tsx` |

**Dependencies:** `rusqlite` + file compression. Can run entirely local (no server).

#### 1C. System Checker
**Orchids source:** `desktop/src/main/system-checker-core.ts` (43KB), `system-checker-handler.ts`

| Task | Solo Target | Reference |
|------|-------------|-----------|
| Detect installed tools (node, bun, git, etc.) | `src-tauri/src/system_commands.rs` | `system-checker-core.ts` |
| Check versions meet minimums | Rust command | — |
| UI for missing prerequisites | `src/components/` | — |

---

### Priority 2 — Project Management & Cloud Integrations

#### 2A. Solo Server (Fork Orchids Server)
**Orchids source:** `server/` (24 route files, 10 agent types, 27 lib modules)

| Task | Notes |
|------|-------|
| Fork orchids server code to `solo-server/` | New repo or monorepo directory |
| Rebrand all "orchid" → "solo" references | Package name, config, headers, comments |
| Replace Clerk auth → Supabase/NextAuth JWT | Middleware rewrite |
| Fresh Supabase project (separate from solo-web) | New database, schema migration |
| Fresh Stripe account | When ready for payments |
| Fresh GitHub App ("solo-ide") | When ready for GitHub integration |
| Fresh Resend/email key | For transactional emails |
| Fresh Redis instance (Upstash) | Rate limiting |
| Fresh PostHog account | Analytics |
| Test all core routes with new credentials | Verify before deploying |

#### 2B. Project Management
**Orchids source:** `desktop/src/renderer/components/main-screen/` (17 components), `server/src/routes/project-routes.ts`

| Task | Solo Target | Reference |
|------|-------------|-----------|
| Main screen / project list UI | `src/components/main-screen/` | `main-screen/` |
| Project creation (start new, import, clone) | Create flow components | `start-new.tsx` |
| Template selection and scaffolding | Template browser | `template-routes.ts` |
| Recent projects list | Main screen | `main-screen/` |
| Project CRUD (connect to Solo Server) | Store + API calls | `project-routes.ts` |

#### 2C. Chat Persistence (Server-Side)
**Orchids source:** `server/src/routes/chat-session-routes.ts`, `message-routes.ts`

| Task | Solo Target | Reference |
|------|-------------|-----------|
| Server-side chat sessions (create, list, fetch) | Solo Server route | `chat-session-routes.ts` |
| Server-side message persistence | Solo Server route | `message-routes.ts` |
| Connect desktop app to server for sessions | API client in desktop | `desktop/src/renderer/lib/api/` |

---

### Priority 3 — Deployment & Integrations

#### 3A. Vercel Deployment
**Orchids source:** `server/src/routes/vercel-routes.ts`, `desktop/src/renderer/components/project-workbench/deployment.tsx`

| Task | Solo Target | Reference |
|------|-------------|-----------|
| Vercel deploy route (server) | Solo Server | `vercel-routes.ts` |
| Domain management route | Solo Server | `vercel-routes.ts` |
| Deployment UI components | Desktop components | `deployment.tsx`, `domain-edit-dialog.tsx` |
| DNS configuration dialog | Desktop component | `dns-config-dialog.tsx` |

**Requires:** Vercel API token (your own)

#### 3B. GitHub Integration
**Orchids source:** `server/src/routes/github-routes.ts`, `desktop/src/main/git-sync-handler.ts`

| Task | Solo Target | Reference |
|------|-------------|-----------|
| Create new GitHub App ("solo-ide") | GitHub settings | — |
| GitHub OAuth route (server) | Solo Server | `github-routes.ts` |
| Repo list, clone, sync UI | Desktop components | `github-sync.tsx` |
| Auto-sync with conflict resolution | Desktop/Server | `git-sync-handler.ts` |

#### 3C. Supabase Provisioning
**Orchids source:** `server/src/routes/supabase-routes.ts`, `server/src/lib/supabase-provisioner.ts`

| Task | Solo Target | Reference |
|------|-------------|-----------|
| Supabase project provisioning route | Solo Server | `supabase-routes.ts` |
| Database studio UI | Desktop components | `database-studio/` (7 components) |
| Supabase connection management | Desktop store | `supabase-integrations.ts` |

---

### Priority 4 — Advanced Features

#### 4A. Stripe Payments & Billing
**Orchids source:** `server/src/routes/stripe-routes.ts`, `stripe-webhook-routes.ts`, `payments-tab.tsx`

| Task | Notes |
|------|-------|
| Fresh Stripe account | New keys, new products |
| Payment routes (server) | Port `stripe-routes.ts` |
| Webhook handler (server) | Port `stripe-webhook-routes.ts` |
| Payments UI (desktop) | Port `payments-tab.tsx`, `stripe-dashboard.tsx` |
| Credit system | Port billing logic |

#### 4B. App Preview (Embedded Browser)
**Orchids source:** `app-preview-tab.tsx`, `app-preview-tabs.tsx`, `app-preview-navigation.tsx`

| Task | Solo Target | Reference |
|------|-------------|-----------|
| Embedded webview for live preview | Tauri webview window | `app-preview-tab.tsx` |
| Preview navigation (URL bar, back/forward) | Component | `app-preview-navigation.tsx` |
| Error overlay | Component | `app-preview-error-overlay.tsx` |
| Browser console log capture | Hook/Server | `browser-logs-handler.ts` |

#### 4C. Mobile Builds (EAS)
**Orchids source:** `server/src/routes/mobile-build-routes.ts`, `server/src/lib/eas-client.ts` (39KB)

| Task | Notes |
|------|-------|
| EAS build routes (server) | Port `mobile-build-routes.ts` |
| Build queue management | Port `build-queue.ts` |
| Mobile build UI | Port `mobile-build-tab.tsx`, `mobile-deployment.tsx` |
| iOS credentials dialog | Port `ios-credentials-dialog.tsx` |

#### 4D. Server-Side Agents (Beyond Coding)
**Orchids source:** `server/src/agents/` (10 agent types)

| Agent | Priority | Notes |
|-------|----------|-------|
| Coding Agent | ✅ Already local in Solo | solo-agent crate |
| Design Agent | Medium | Generates UI from prompts |
| Database Agent | Medium | SQL query generation |
| Template Agent | Low | Project scaffolding |
| Payments Agent | Low | Stripe webhook setup |
| Clone Agent | Low | Website cloning |
| Design Kit Agent | Low | Design system generation |
| Auth Agent | Low | OAuth flow automation |

#### 4E. Other Advanced Features

| Feature | Orchids Source | Priority |
|---------|---------------|----------|
| Screen recording | `screen-recorder-handler.ts` | Low |
| Auto-updater | `update-handler.ts` | Medium (Tauri has built-in) |
| Analytics | `analytics-routes.ts`, `analytics-tab.tsx` | Low |
| Onboarding flow | `onboarding/` (6 components) | Medium |
| Design canvas | `app-editor.ts` store | Low |

---

## Architecture Translation Guide

### IPC Mapping

| Orchids (Electron) | Solo (Tauri) |
|-------------------|--------------|
| `window.App.fs.readFile(path)` | `invoke('read_file', { path })` |
| `window.App.git.status()` | `invoke('git_status', {})` |
| `window.App.terminal.create(opts)` | `invoke('spawn_pty', { cwd, shell })` |
| `ipcRenderer.on('event', cb)` | `listen('backend-event', cb)` |
| `better-sqlite3` | `rusqlite` (Rust) |
| `chokidar` (file watcher) | `notify` crate (already in Solo) |
| `simple-git` | `git2` crate or git CLI |
| `node-pty` | `portable-pty` (already in Solo) |

### What Runs Local vs Server

| Feature | Local (Tauri Rust) | Server Required |
|---------|-------------------|-----------------|
| File operations | ✅ | |
| Terminal | ✅ | |
| Git operations | ✅ | |
| Code parsing | ✅ | |
| AI agent (direct API) | ✅ | |
| AI agent (with tools) | ✅ | |
| Checkpoints | ✅ | |
| System check | ✅ | |
| Project persistence | | ✅ (cloud sync) |
| Payments/billing | | ✅ |
| Vercel deployment | | ✅ |
| GitHub App | | ✅ |
| Analytics | | ✅ |
| Mobile builds | | ✅ |

---

## Credential Separation (CRITICAL)

- **NEVER** copy orchids `.env` files into solo
- **NEVER** reuse orchids API keys, database URLs, or tokens
- Create `.env.example` for solo-server with all required vars (no values)
- Use different Supabase projects for solo-web (marketing) and solo-server (app data)

### Fresh Accounts Needed

| Service | Purpose | Status |
|---------|---------|--------|
| Supabase | Solo Server database | ⬜ Not created |
| Anthropic | AI API key | ⬜ Not created |
| Stripe | Payments | ⬜ Not created |
| GitHub App | "solo-ide" | ⬜ Not created |
| Resend | Transactional email | ⬜ Not created |
| Vercel | Deploy token | ⬜ Not created |
| Redis (Upstash) | Rate limiting | ⬜ Not created |
| PostHog | Analytics | ⬜ Not created |

---

## Orchids Source Reference

| Category | Location | Count |
|----------|----------|-------|
| Server routes | `orchids/server/src/routes/` | 24 files |
| Server agents | `orchids/server/src/agents/` | 10 agent types |
| Server libs | `orchids/server/src/lib/` | 27 modules |
| Desktop components | `orchids/desktop/src/renderer/components/` | 166 components |
| Desktop stores | `orchids/desktop/src/renderer/stores/` | 17 stores |
| Desktop main process | `orchids/desktop/src/main/` | 28 handlers |
| Desktop API clients | `orchids/desktop/src/renderer/lib/api/` | 14 modules |
| Type definitions | `orchids/server/src/types/` | 28 type files |
| Function call UI | `orchids/desktop/.../function-calls/v2/` | 30+ components |

---

## Estimated Work

| Phase | Files | LOC | Priority |
|-------|-------|-----|----------|
| Git integration (Rust + React) | ~12 | ~2,000 | P1 — Next |
| Checkpoint system | ~6 | ~800 | P1 |
| System checker | ~4 | ~500 | P1 |
| Solo Server (fork + rebrand) | ~50 modified | ~500 changed | P2 |
| Project management UI | ~20 | ~2,500 | P2 |
| Chat persistence | ~8 | ~1,000 | P2 |
| Vercel deployment | ~10 | ~1,500 | P3 |
| GitHub integration | ~10 | ~1,500 | P3 |
| Supabase provisioning | ~8 | ~1,200 | P3 |
| Stripe payments | ~10 | ~1,500 | P4 |
| App preview | ~8 | ~1,200 | P4 |
| Mobile builds | ~12 | ~2,000 | P4 |
| Server-side agents | ~20 | ~3,000 | P4 |
| **Total** | **~178** | **~19,200** | — |
