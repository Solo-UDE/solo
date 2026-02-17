# Git Features — Solo IDE

Comprehensive documentation of the git integration in Solo IDE, powered by the `git2` Rust crate with a Tauri IPC bridge to the React frontend.

## Architecture

- **Backend**: `apps/desktop/src-tauri/src/git_commands.rs` — all git operations via `git2`
- **Protocol**: `crates/solo-protocol/src/lib.rs` — IPC type definitions (auto-generates TS bindings)
- **IPC wrappers**: `apps/desktop/src/lib/tauri/git.ts` — typed `invoke()` calls
- **Store**: `apps/desktop/src/stores/gitStore.ts` — Zustand + Immer state management
- **UI**: `apps/desktop/src/components/source-control/` — sidebar panel components

All git commands use `tokio::task::spawn_blocking` because `git2::Repository` is `!Send`. Each command opens a fresh repo handle.

## Commands (16 total)

### Repository Management

| Command | Rust fn | IPC wrapper | Status |
|---------|---------|-------------|--------|
| Get repo status | `git_get_status` | `gitGetStatus()` | Active |
| Setup GitHub integration | `git_setup` | `gitSetup()` | Active |
| Get current SHA | `git_get_current_sha` | `gitGetCurrentSha()` | Built, unused in UI |
| Cleanup stale locks | `git_cleanup_locks` | `gitCleanupLocks()` | Built, unused in UI |

### Change Tracking

| Command | Rust fn | IPC wrapper | Status |
|---------|---------|-------------|--------|
| Get changed files | `git_get_changes` | `gitGetChanges()` | Active |
| Get file diff | `git_get_file_diff` | `gitGetFileDiff()` | Active |

### Staging

| Command | Rust fn | IPC wrapper | Status |
|---------|---------|-------------|--------|
| Stage file | `git_stage_file` | `gitStageFile()` | Active |
| Unstage file | `git_unstage_file` | `gitUnstageFile()` | Active |
| Stage all | `git_stage_all` | `gitStageAll()` | Active |
| Unstage all | `git_unstage_all` | `gitUnstageAll()` | Active |

### Committing & Syncing

| Command | Rust fn | IPC wrapper | Status |
|---------|---------|-------------|--------|
| Commit staged changes | `git_commit` | `gitCommit()` | Active |
| Push to remote | `git_push` | `gitPush()` | Active |
| Pull from remote | `git_pull` | `gitPull()` | Active |

### Discard

| Command | Rust fn | IPC wrapper | Status |
|---------|---------|-------------|--------|
| Discard file | `git_discard_file` | `gitDiscardFile()` | Active |
| Discard all | `git_discard_all` | `gitDiscardAll()` | Active |

### Branch Management

| Command | Rust fn | IPC wrapper | Status |
|---------|---------|-------------|--------|
| Create branch | `git_create_branch` | `gitCreateBranch()` | Active |

## Internal Helpers (10)

| Helper | Purpose |
|--------|---------|
| `get_workspace_path` | Reads workspace root from `FsState` |
| `emit_git_progress` | Emits `git:progress` BackendEvent (not yet consumed by frontend) |
| `emit_git_changes_updated` | Emits `git:changes_updated` — triggers UI re-poll |
| `cleanup_git_locks` | Removes stale `.git/*.lock` files older than 5 minutes |
| `ensure_local_repo_scope` | Opens or initializes repo, verifies workdir matches project |
| `upsert_remote` | Creates or updates a git remote URL |
| `get_github_integ_info` | Checks if `github-integ` remote and tracking branch exist |
| `make_fetch_options` | Creates `FetchOptions` with token auth callbacks |
| `make_push_options` | Creates `PushOptions` with token auth callbacks |
| `clean_untracked` | Deletes untracked files from working directory (used by `discard_all`) |
| `get_blob_content` | Reads file content from a git treeish (e.g., `HEAD:path/to/file`) |

## Remote Pattern: `github-integ`

Solo uses a dedicated remote named `github-integ` (not `origin`) for GitHub integration. This avoids conflicts with user's existing git remotes. The URL is set during `git_setup` and temporarily replaced with an authenticated URL during push/pull operations, then restored afterwards.

## BackendEvents

| Event | Payload | Status |
|-------|---------|--------|
| `git:progress` | `{ operation, message }` | Emitted but **not listened to** on frontend |
| `git:changes_updated` | `{}` | Active — triggers store re-fetch via polling |

## State Management

### `GitRepoStatus`

```typescript
{
  is_repo: boolean;
  current_branch: string | null;
  head_sha: string | null;
  has_remote: boolean;
  remote_url: string | null;
  commits_ahead: number | null;  // commits ahead of remote tracking branch
}
```

### Store State

- `repoStatus` — cached repo status, polled every 5 seconds
- `changedFiles` — list of files with status, insertions, deletions, staged flag
- `changesSummary` — aggregate insertions/deletions
- `commitsAhead` — number of unpushed commits (from `repoStatus.commits_ahead`)
- `commitMessage` — textarea input
- `currentBranch` / `githubRepoUrl` — synced from repo status
- Operation flags: `isCommitting`, `isPushing`, `isPulling`, `isDiscarding`, `isCreatingBranch`, `isLoading`

## Commit/Push Separation

Commit and push are fully separate operations:

1. **Commit** (`git_commit`): Creates a local commit from staged changes. Clears the commit message textarea on success.
2. **Push** (`git_push`): Pushes existing commits to remote. Does NOT create commits for staged-but-uncommitted changes.

The only exceptions where push creates commits:
- **Fresh repo** (no commits at all): Creates an initial commit from staged changes
- **Synthetic commit**: When remote has diverged, creates a synthetic merge commit parented on the remote
- **Orphan commit**: When remote branch doesn't exist yet, creates a parentless commit

## `commits_ahead` Feature

The `commits_ahead` field in `GitRepoStatus` uses `git2::Revwalk` to count local commits not yet on the remote:

- Walks from HEAD, hiding the remote tracking ref OID
- If no remote tracking branch but remote exists, counts all commits from HEAD
- If no remote, returns `None`

The Push button:
- Shows a badge with the count when `commits_ahead > 0`
- Disabled when `commits_ahead === 0` or `null`
- Tooltip shows "Push (N commits ahead)"

## Create Branch

`git_create_branch` validates the branch name (rejects spaces, `..`, `~`, `^`, `:`, `\`, leading `-`, trailing `/`, `.lock`), creates a branch from HEAD, and checks it out.

UI: Plus icon in the BranchSelector popover header. Inline text input appears, Enter to create, Escape to cancel. Shows error text on failure.

## Future Work

Features not yet implemented:

- **Branch switching** — checkout existing branch with stash/restore
- **Branch deletion** — delete local (and optionally remote) branches
- **Branch listing** — show all local and remote branches in selector
- **Merge** — merge branches with conflict resolution UI
- **Stash** — manual stash save/pop/list/drop
- **Log** — commit history viewer
- **Blame** — line-level blame annotations in editor
- **Cherry-pick** — apply specific commits
- **Rebase** — interactive rebase UI
- **Tags** — create and push tags
- **Submodules** — submodule status and operations
- **Progress events** — consume `git:progress` events in frontend for operation progress UI
