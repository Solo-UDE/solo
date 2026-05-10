# Phase 8 Branch Changelog — `phase-8/git-integration`

> **Single source of truth** for all uncommitted changes on this branch.
> Last updated: 2026-02-14

---

## Table of Contents

1. [Overview](#overview)
2. [OpenAI OAuth / Codex Flow (RFC 8693)](#openai-oauth--codex-flow-rfc-8693)
3. [Claude Code CLI Auth Improvements](#claude-code-cli-auth-improvements)
4. [Git Integration Fixes & Enhancements (Phase 8.5)](#git-integration-fixes--enhancements-phase-85)
5. [UI / UX Polish](#ui--ux-polish)
6. [All Modified Files](#all-modified-files)
7. [New Files](#new-files)
8. [Functions & Commands Reference](#functions--commands-reference)
9. [Testing Checklist](#testing-checklist)

---

## Overview

This branch contains **four categories** of changes made on top of the existing Phase 8 git integration commits:

| Category | Files | Description |
|----------|-------|-------------|
| **OpenAI OAuth (Codex)** | 4 Rust files | RFC 8693 token exchange, account_id propagation, ChatGPT-Account-ID header |
| **Claude Code CLI Auth** | 2 TSX files, 1 TS file | CLI installation check/install, improved UX copy |
| **Git Phase 8.5** | 8 files (Rust + TS + TSX) | Push auto-commit fix, commits_ahead, create branch, docs |
| **UI/UX Polish** | 6 files | Sidebar pointer events, toast notifications, split divider cleanup, settings brain icon, workspace store fix |

---

## OpenAI OAuth / Codex Flow (RFC 8693)

### What changed

The OpenAI OAuth flow was upgraded to perform an **RFC 8693 token exchange** — converting the OAuth `id_token` into a usable OpenAI API key. This is how ChatGPT Pro/Max subscribers get API access via OAuth.

### Files & changes

#### `crates/solo-agent/src/oauth/providers/openai.rs`

| Function | Change |
|----------|--------|
| `OpenAIOAuthConfig::build_auth_url()` | Added `originator=solo_ide` parameter for attribution |
| `OpenAIOAuthConfig::exchange_code()` | After getting tokens, calls `obtain_api_key()` to exchange `id_token` → API key. Falls back to `access_token` if exchange fails. |
| `OpenAIOAuthConfig::obtain_api_key()` | **NEW** — RFC 8693 token exchange: POSTs to token endpoint with `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`, `subject_token=<id_token>`, `audience=https://api.openai.com/v1`. Returns API key. |
| `OpenAIOAuthConfig::refresh_token()` | After refreshing, re-exchanges `id_token` for API key |
| `TokenExchangeResponse` struct | **NEW** — Deserializes `{ access_token }` from exchange response |
| Test `test_build_auth_url` | Updated to assert `originator=solo_ide` |

#### `crates/solo-agent/src/credentials.rs`

| Change | Details |
|--------|---------|
| `CredentialInfo` struct | Added `account_id: Option<String>` field |
| All `CredentialInfo` construction sites (8 places) | Pass `account_id` — set from `OpenAIOAuthToken.account_id` for OpenAI OAuth, `None` for all others |

#### `crates/solo-agent/src/openai.rs`

| Function | Change |
|----------|--------|
| `OpenAIProvider` struct | Added `account_id: Option<String>` field |
| `OpenAIProvider::new()` | Sets `account_id: None` |
| `OpenAIProvider::new_with_oauth()` | **NEW** — Accepts `account_id` parameter |
| `OpenAIChatRequest` struct | Added `store: Option<bool>` field (skip_serializing_if None) |
| `send_message()` | Sets `store: Some(false)` when `account_id.is_some()` to prevent conversation storage on OpenAI's side |
| `stream_openai_response()` | Added `account_id` parameter; sends `ChatGPT-Account-ID` header when present |

#### `crates/solo-agent/src/lib.rs`

| Change | Details |
|--------|---------|
| `AgentManager` provider creation | OpenAI now uses `new_with_oauth()` passing `credential_info.account_id` |

### How it works (end to end)

1. User clicks "Sign in with ChatGPT" → OAuth flow opens browser
2. User authenticates → callback returns authorization code
3. `exchange_code()` exchanges code for tokens (access_token + id_token + refresh_token)
4. `obtain_api_key()` exchanges id_token for a real API key via RFC 8693
5. API key + account_id stored in `OpenAIOAuthToken`
6. When creating OpenAI provider, `account_id` is passed through
7. API requests include `ChatGPT-Account-ID` header + `store: false`

---

## Claude Code CLI Auth Improvements

### Files & changes

#### `apps/desktop/src/components/settings/ClaudeLoginModal.tsx`

- **NEW step: `not-installed`** — Checks if Claude CLI is installed via `checkClaudeCliInstalled()`
- **NEW step: `installing`** — Shows spinner while `installClaudeCli()` runs
- Copy-to-clipboard for `npm install -g @anthropic-ai/claude-code` command
- "I already installed it — continue" skip button
- Improved flow: checking → not-installed → installing → ready → waiting → complete

#### `apps/desktop/src/components/settings/tabs/AITab.tsx`

- Updated button text: "For free API access via Claude Code CLI" → "Use your Claude Pro/Max subscription for API access"
- Updated connected state text: "Using credentials from Claude Code." → "Authenticated via Claude Code CLI — using your Claude subscription for API access."

---

## Git Integration Fixes & Enhancements (Phase 8.5)

### Bug Fixes

#### 1. Push auto-commit leak — CRITICAL FIX

**File:** `apps/desktop/src-tauri/src/git_commands.rs`

**Before:** `git_push` checked for staged changes and silently committed them with whatever message was passed (defaulting to `'Sync from Solo'`). This defeated the commit/push separation.

**After:** The auto-commit block (25 lines) was removed. Push now only pushes existing commits. The only commits push creates are:
- Initial commit (fresh repo with no commits at all)
- Synthetic commit (remote divergence — rebases local tree onto remote)
- Orphan commit (remote branch doesn't exist yet)

#### 2. `commit_message` made optional on `git_push`

**Rust:** `commit_message: String` → `commit_message: Option<String>`, with `unwrap_or("Sync from Solo IDE")` for synthetic commits.

**TypeScript IPC:** `commitMessage` parameter now optional, passes `null` when absent.

**Store:** `push()` no longer takes `commitMessage` parameter. Removed redundant `state.commitMessage = ''` that was clearing an already-empty field.

**UI:** `handlePush` no longer passes `'Sync from Solo'`.

#### 3. `git_commit` missing `cleanup_git_locks`

Added `cleanup_git_locks(&workspace_path)` at the start of `git_commit` to handle stale lock files from crashed operations.

### New Features

#### 4. `commits_ahead` — Protocol, Backend, Store, UI

**Protocol** (`crates/solo-protocol/src/lib.rs`):
- Added `commits_ahead: Option<u32>` to `GitRepoStatus`

**Backend** (`git_commands.rs` → `git_get_status`):
- Uses `git2::Revwalk` to count commits between HEAD and remote tracking ref
- Tries `github-integ/<branch>` first, then `origin/<branch>`
- If remote exists but no tracking branch, counts all commits from HEAD
- Returns `None` if no remote

**Store** (`gitStore.ts`):
- Added `commitsAhead: number | null` state
- Synced from `status.commits_ahead` in `fetchRepoStatus`
- Reset to `null` in `reset()`

**UI** (`SourceControlPanel.tsx`):
- Push button disabled when `commitsAhead === 0 || commitsAhead === null`
- Badge overlay shows count when `commitsAhead > 0`
- Tooltip: "Push (N commits ahead)"

#### 5. `git_create_branch` — Full Stack

**Rust** (`git_commands.rs`):
```rust
pub async fn git_create_branch(
    fs_state: State<'_, FsState>,
    app: AppHandle,
    branch_name: String,
) -> Result<(), String>
```
- Validates branch name: rejects spaces, `..`, `~`, `^`, `:`, `\`, leading `-`, trailing `/`, `.lock`, null bytes
- Opens repo, gets HEAD commit
- `repo.branch(name, &commit, false)` — fails if branch exists
- `repo.set_head()` + `repo.checkout_tree()` to checkout
- Emits `git:changes_updated`

**Registered** in `lib.rs` generate_handler.

**IPC** (`git.ts`):
```typescript
export const gitCreateBranch = (branchName: string) =>
  invoke<void>('git_create_branch', { branchName });
```

**Store** (`gitStore.ts`):
- `isCreatingBranch: boolean` state
- `createBranch(name: string)` action — calls IPC, refreshes status + changes

**UI** (`BranchSelector.tsx`):
- Plus icon in popover header opens inline input
- Enter to create, Escape to cancel
- `CircleNotch` spinner during creation
- Error text below input on failure
- Closes popover on success

---

## UI / UX Polish

### Sidebar Resize — Pointer Events (zero-lag dragging)

**Files:** `App.tsx`, `PrimarySidebar.tsx`, `markdown-preview.css`

- Replaced `mousedown/mousemove/mouseup` with `pointerdown/pointermove/pointerup` + pointer capture
- Direct DOM manipulation during drag (no React re-renders)
- `body.is-resizing` class kills all transitions during resize
- Removed 3-dot grip indicator from split dividers
- `PrimarySidebar` converted to `forwardRef` to accept ref from App

### Toast Notifications (sonner)

**File:** `App.tsx`

- Added `<Toaster richColors position="bottom-right" theme={resolvedTheme} />`
- `useColorScheme()` now returns resolved theme for Toaster
- Toasts used in: commit success/error, push auth/success/error, pull auth/success/error

### Settings Page

**File:** `SettingsPage.tsx`

- Replaced `Robot` (Phosphor) icon with custom Brain SVG for AI tab

### Workspace Store

**File:** `workspaceStore.ts`

- On workspace switch: closes terminal panel if open
- Uses `startPolling()` instead of manual `fetchRepoStatus()` + `fetchChanges()` for git re-detection

### Markdown Split Pane

**File:** `MarkdownSplitPane.tsx`

- Removed 3-dot grip indicator from split divider (self-closing `<div />`)

---

## All Modified Files

| # | File | Category |
|---|------|----------|
| 1 | `crates/solo-agent/src/oauth/providers/openai.rs` | OpenAI OAuth |
| 2 | `crates/solo-agent/src/credentials.rs` | OpenAI OAuth |
| 3 | `crates/solo-agent/src/openai.rs` | OpenAI OAuth |
| 4 | `crates/solo-agent/src/lib.rs` | OpenAI OAuth |
| 5 | `apps/desktop/src/components/settings/ClaudeLoginModal.tsx` | Claude CLI Auth |
| 6 | `apps/desktop/src/components/settings/tabs/AITab.tsx` | Claude CLI Auth |
| 7 | `apps/desktop/src-tauri/src/git_commands.rs` | Git Phase 8.5 |
| 8 | `apps/desktop/src-tauri/src/lib.rs` | Git Phase 8.5 |
| 9 | `crates/solo-protocol/src/lib.rs` | Git Phase 8.5 |
| 10 | `crates/solo-protocol/apps/desktop/src/bindings/GitRepoStatus.ts` | Git Phase 8.5 (auto-gen) |
| 11 | `apps/desktop/src/lib/tauri/git.ts` | Git Phase 8.5 |
| 12 | `apps/desktop/src/stores/gitStore.ts` | Git Phase 8.5 |
| 13 | `apps/desktop/src/components/source-control/SourceControlPanel.tsx` | Git Phase 8.5 |
| 14 | `apps/desktop/src/components/source-control/BranchSelector.tsx` | Git Phase 8.5 |
| 15 | `apps/desktop/src/App.tsx` | UI Polish |
| 16 | `apps/desktop/src/components/sidebar/PrimarySidebar.tsx` | UI Polish |
| 17 | `apps/desktop/src/components/editor/MarkdownSplitPane.tsx` | UI Polish |
| 18 | `apps/desktop/src/components/editor/markdown-preview.css` | UI Polish |
| 19 | `apps/desktop/src/components/settings/SettingsPage.tsx` | UI Polish |
| 20 | `apps/desktop/src/stores/workspaceStore.ts` | UI Polish |
| 21 | `docs/PROGRESS.md` | Documentation |

## New Files

| File | Description |
|------|-------------|
| `docs/GIT_FEATURES.md` | Comprehensive git feature documentation (commands, helpers, patterns, future work) |
| `docs/PHASE-8-BRANCH-CHANGELOG.md` | This file — single source of truth for branch changes |

---

## Functions & Commands Reference

### New Rust Commands

| Command | Signature | Description |
|---------|-----------|-------------|
| `git_create_branch` | `(fs_state, app, branch_name: String) -> Result<(), String>` | Creates and checks out a new local branch from HEAD |

### Modified Rust Commands

| Command | Change |
|---------|--------|
| `git_push` | `commit_message` now `Option<String>`; removed auto-commit block for existing repos |
| `git_commit` | Added `cleanup_git_locks()` at start |
| `git_get_status` | Computes and returns `commits_ahead` via revwalk |

### New Rust Functions

| Function | File | Description |
|----------|------|-------------|
| `OpenAIOAuthConfig::obtain_api_key()` | `openai.rs` (OAuth) | RFC 8693 token exchange: id_token → API key |
| `OpenAIProvider::new_with_oauth()` | `openai.rs` (provider) | Constructor with OAuth metadata (account_id) |

### New TypeScript Functions

| Function | File | Description |
|----------|------|-------------|
| `gitCreateBranch(branchName)` | `git.ts` | IPC wrapper for `git_create_branch` |

### Modified TypeScript Functions

| Function | File | Change |
|----------|------|--------|
| `gitPush()` | `git.ts` | `commitMessage` now optional, passes `null` |
| `push()` | `gitStore.ts` | Removed `commitMessage` param, removed redundant clear |
| `createBranch()` | `gitStore.ts` | **NEW** store action |

---

## Testing Checklist

> Update status as tests are performed. Mark with date when verified.

### OpenAI OAuth / Codex Flow

- [ ] **OAuth sign-in**: Click "Sign in with ChatGPT" → browser opens → authenticate → redirected back
- [ ] **Token exchange**: After OAuth, check logs for "Successfully exchanged id_token for API key"
- [ ] **API key works**: Send a message to OpenAI provider → get a response (not auth error)
- [ ] **Account ID header**: In network/logs, verify `ChatGPT-Account-ID` header is sent
- [ ] **store: false**: Verify API request body includes `"store": false` when using OAuth
- [ ] **Token refresh**: Let token expire (or simulate) → verify auto-refresh + re-exchange
- [ ] **Fallback**: If token exchange fails, verify it falls back to access_token with warning log
- [ ] **originator param**: Verify OAuth URL contains `originator=solo_ide`

### Claude Code CLI Auth

- [ ] **CLI not installed**: When Claude CLI is not installed → shows "not-installed" step with install command
- [ ] **Copy command**: Click copy button → `npm install -g @anthropic-ai/claude-code` copied to clipboard
- [ ] **Install CLI**: Click "Install Claude Code" → shows installing spinner → installs → moves to "ready"
- [ ] **Skip install**: Click "I already installed it — continue" → skips to "ready" step
- [ ] **Login flow**: Click "Open Terminal" → terminal opens with `claude /login` → follow prompts
- [ ] **Verify auth**: After authenticating, click "Verify" → detects credentials → success
- [ ] **Already authenticated**: Open modal when already logged in → auto-detects → shows success

### Git — Push Auto-Commit Fix

- [ ] **Stage files, don't commit, press Push**: Should push only existing commits (or fail gracefully), NOT silently create a commit
- [ ] **Commit then push**: Stage → Commit (message clears) → Push → works normally
- [ ] **Fresh repo push**: New repo with staged files → Push creates initial commit (expected)

### Git — commits_ahead

- [ ] **After commit**: `commits_ahead` increments, Push button badge shows count
- [ ] **After push**: `commits_ahead` goes to 0, Push button disables
- [ ] **No remote**: `commits_ahead` is null, Push button disabled
- [ ] **Remote but no tracking branch**: Shows total local commit count as ahead
- [ ] **Badge display**: Badge shows correct number, tooltip shows "Push (N commits ahead)"

### Git — Create Branch

- [ ] **Create branch**: Click + in BranchSelector → type name → Enter → branch created
- [ ] **Branch selector updates**: After creation, current branch name updates in selector
- [ ] **Duplicate name**: Try creating existing branch name → error shown below input
- [ ] **Invalid name**: Try names with spaces, `..`, `~` → error shown
- [ ] **Escape cancels**: Press Escape → input disappears, no branch created
- [ ] **Spinner shows**: During creation, CircleNotch spinner appears

### Git — Lock File Recovery

- [ ] **git_commit with stale lock**: Create a stale `.git/index.lock` (>5 min old) → commit should succeed after cleanup

### Toast Notifications

- [ ] **Commit success**: Shows green "Changes committed" toast
- [ ] **Commit error**: Shows red toast with error description
- [ ] **Push not signed in**: Shows red "Not signed in" toast
- [ ] **Push success**: Shows green "Pushed to remote" toast
- [ ] **Push error**: Shows red toast with error description
- [ ] **Pull not signed in**: Shows red "Not signed in" toast
- [ ] **Pull success**: Shows green "Pulled from remote" toast
- [ ] **Pull error**: Shows red toast with error description

### UI Polish

- [ ] **Sidebar resize**: Drag divider → smooth, no lag, no layout jumps
- [ ] **Sidebar resize cursor**: col-resize cursor during drag
- [ ] **Sidebar double-click**: Double-click divider → resets to default width
- [ ] **Split pane divider**: No 3-dot grip visible (clean line only)
- [ ] **Settings AI tab**: Brain icon shows instead of Robot
- [ ] **Workspace switch**: Terminal panel closes on workspace switch
- [ ] **Theme**: Toaster matches current theme (dark/light)

---

## Notes

- `cargo check` shows `tauri::generate_context!()` panic — this is expected when `../dist` doesn't exist (needs frontend build first)
- Pre-existing TS errors exist in bindings (barrel import `../bindings` not found) — not from our changes
- The `git:progress` BackendEvent is emitted but not yet consumed on the frontend — future work
