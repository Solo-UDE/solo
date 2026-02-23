# Automated Development Pipeline: GitHub → Linear → Claude Agent → Worktree → PR

> **Status**: Planning document — no implementation yet. This captures the full design for future iteration.

## Context

**Problem**: Solo IDE development requires manual triage, implementation, and review of GitHub issues. The user wants a fully automated pipeline where:
1. GitHub issues flow into Linear tickets (auto-sync)
2. Claude Code automatically picks up issues and starts working
3. Work happens in **isolated git worktrees** (not the main workspace)
4. The base branch for worktrees is **user-configurable** (not always master)
5. Worktrees auto-cleanup when work is marked "Done" (branch stays on GitHub)
6. The user stays in the loop: feedback, confirmations, status updates

**Target repo**: `https://github.com/Solo-UDE/solo` (private, org members only)
**Notifications**: GitHub-native only (no Slack for now)

**Key discovery**: Solo already has a **complete worktree system** — 11 Tauri commands, `solo-git` crate (~40KB), Zustand store, event streaming, agent binding. The automation layer extends this existing infrastructure.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    CLOUD (GitHub Actions)                        │
│                                                                 │
│  GitHub Issue → Claude Triage → Labels → Claude Implement → PR  │
│       ↕              ↕                        ↕                 │
│  Linear Sync    Review Bot              @claude Bot             │
└───────────────────────┬─────────────────────────────────────────┘
                        │ (GitHub webhooks / polling)
┌───────────────────────▼─────────────────────────────────────────┐
│                    LOCAL (Solo IDE)                              │
│                                                                 │
│  Issue Panel → Pick Issue → Create Worktree → Agent Session     │
│       ↕            ↕              ↕                ↕            │
│  Linear MCP   Base Branch    ~/.solo/wt/     Claude Code -p     │
│               Config                          (headless)        │
│                                                    ↓            │
│                                              Feedback Loop      │
│                                        (plan → approve → code)  │
│                                                    ↓            │
│                                              Push → PR          │
│                                                    ↓            │
│                                     Mark "Done" → Cleanup WT    │
│                                     (branch stays on GitHub)    │
└─────────────────────────────────────────────────────────────────┘
```

**Two execution paths** (both produce PRs):
- **Cloud path**: GitHub Actions runs Claude Code on issue events (no local machine needed)
- **Local path**: Solo IDE picks an issue → spins up worktree → runs agent locally (richer context, faster iteration, user-in-the-loop)

---

## PART 1: Cloud Automation (GitHub Actions)

### Phase A: Linear ↔ GitHub Sync (Config Only — No Code)

Linear's native GitHub integration handles bidirectional sync.

**Steps**:
1. Linear Settings → Integrations → GitHub → Authorize on `Solo-UDE/solo`
2. Enable "GitHub Issues Sync" for the Solo team
3. Map: GitHub `open` → Linear `Triage`, GitHub `closed` → Linear `Done`
4. Labels + comments sync bidirectionally
5. Test: create GitHub issue → verify Linear ticket appears

---

### Phase B: GitHub Workflow Files (4 files)

All workflows live in the `Solo-UDE/solo` repo at `.github/workflows/`.

#### B1: `claude-triage.yml` — Auto-categorize new issues
- **Trigger**: `issues: [opened]`
- **Purpose**: Add type labels (bug/feature/question), domain labels (frontend/backend/git), priority labels, check duplicates
- **Key**: If issue is clear + well-scoped → adds `claude` label (triggers implementation)
- **Safety**: Confidence threshold — only label `claude` for clearly scoped issues with acceptance criteria
- **Max turns**: 8 | **Tools**: `gh issue`, Read, Glob, Grep
- **Concurrency**: `group: claude-triage-${{ github.event.issue.number }}`

#### B2: `claude-implement.yml` — Implement issues as PRs
- **Trigger**: `issues: [labeled]` where label = `claude`
- **Purpose**: Analyze issue, create `claude/*` branch, implement, verify compilation, open PR
- **Tiered approach**:
  - `bug` → fix immediately, open PR
  - `feature` WITHOUT `claude-approved` → post plan as comment, wait for approval
  - `feature` WITH `claude-approved` → implement fully
- **System deps**: Installs webkit/GTK (from existing `ci.yml` pattern), Rust, bun
- **Verification**: cargo check + clippy + fmt + bun typecheck before PR
- **Self-repair**: If CI checks fail, attempt fix up to 3 times, then label `needs-human-fix`
- **Max turns**: 30 | **Tools**: Read, Write, Edit, Bash(cargo/bun/git/gh), Glob, Grep
- **Blocked**: rm, Cargo.toml edits, auth file edits, `.github/` writes
- **Concurrency**: `group: claude-implement-${{ github.event.issue.number }}`, `cancel-in-progress: true`
- **Timeout**: `timeout-minutes: 30`

#### B3: `claude-review.yml` — Auto-review PRs
- **Trigger**: `pull_request: [opened, synchronize]` on paths `solo/**`
- **Purpose**: Code review against Solo conventions (IPC pattern, Tailwind v4, design system)
- **Sticky comment** (updates one comment, no spam) + inline comments
- **Loop prevention**: Skip reviews on PRs authored by `claude[bot]` to prevent infinite loops
- **Max turns**: 10 | **Tools**: Read, Glob, Grep, gh pr commands

#### B4: `claude-interactive.yml` — @claude mention handler
- **Trigger**: `issue_comment: [created]`, `pull_request_review_comment: [created]`
- **Purpose**: Answer `@claude` questions, explain code, suggest approaches
- **Full repo context** (fetch-depth: 0), no tool restrictions

---

### Phase C: GitHub Labels (one-time setup via `gh` CLI)

| Label | Color | Purpose |
|-------|-------|---------|
| `claude` | `#00FF00` | Triggers auto-implementation |
| `claude-approved` | `#00CC00` | Approves feature plan |
| `claude-needs-clarification` | `#fbca04` | Agent needs more info |
| `claude-failed` | `#d73a4a` | Agent failed after retries |
| `needs-human-fix` | `#e4e669` | CI failed, needs human |
| `bug` | `#d73a4a` | Type |
| `feature` | `#0075ca` | Type |
| `enhancement` | `#a2eeef` | Type |
| `frontend` | `#f9a825` | Domain |
| `backend` | `#b71c1c` | Domain |
| `git` / `agent` / `terminal` / `editor` | various | Domain |
| `critical` / `high` / `medium` / `low` | red→green | Priority |
| `needs-info` | `#fbca04` | Triage: needs more details |

---

### Phase D: CLAUDE.md CI Agent Section

Add to `solo/CLAUDE.md` — section guiding the GitHub Actions agent:
- Branch naming: `claude/fix-<num>-<desc>`, `claude/feat-<num>-<desc>`
- PR format: `[#<issue>] <Title>`, body with `Fixes #<num>`
- Verification checklist (cargo check/clippy/fmt/typecheck)
- Scope limits: no Cargo.toml, no auth files, one issue = one PR
- Security: never read `.env*`, `*.key`, `*.pem`, `**/credentials*`

---

### Phase E: Approval Gates

| Tier | What | Approval |
|------|------|----------|
| Auto | Triage, review, @claude Q&A | None |
| Auto | Bug fixes (`bug` + `claude`) | PR review only |
| Plan-first | Features (`feature` + `claude`) | Maintainer adds `claude-approved` |
| Human only | Protocol types, deps, config, auth | Never automated |

Branch protection on `main`: require 1 review + CI pass.

---

### Phase F: Issue Templates

`.github/ISSUE_TEMPLATE/bug_report.yml` and `feature_request.yml` — structured YAML forms with fields that help the triage agent categorize faster (steps to reproduce, expected behavior, screenshots, area of codebase).

---

## PART 2: Local Agent Automation (Solo IDE Feature)

This extends Solo's **existing worktree system** to support issue-driven agent sessions.

### Existing Infrastructure (Already Built)

| Component | File | Status |
|-----------|------|--------|
| `WorktreeManager` | `crates/solo-git/src/lib.rs` (~40KB) | Complete |
| `WorktreeState` | `src-tauri/src/worktree_commands.rs` | Complete (11 commands) |
| `useWorktreeStore` | `src/stores/worktreeStore.ts` | Complete |
| `worktree.*` IPC wrappers | `src/lib/tauri/worktree.ts` | Complete |
| Event stream | `src/hooks/useWorktreeStream.ts` | Complete |
| Protocol types | `crates/solo-protocol/src/lib.rs` | Complete (`CreateWorktreeRequest` has `base: Option<String>`) |
| Agent binding | `worktree_bind_agent` / `worktree_unbind_agent` | Complete |
| Setup commands | `worktree_set_setup_commands` | Complete |
| Persistence | `~/.solo/worktrees/{repo}/worktrees.json` | Complete |

**Key**: `CreateWorktreeRequest.base` already supports configurable base branch.

### What Needs to Be Built

#### 2A: Issue-Driven Worktree Settings (UI)

**File**: `src/components/settings/AutomationSettings.tsx` (new settings tab)

Add to the Settings panel a new "Automation" tab with:

```
┌─ Automation Settings ─────────────────────────────┐
│                                                    │
│  Base Branch for Issues                            │
│  ┌──────────────────────────────────┐              │
│  │ main                         ▼   │              │
│  └──────────────────────────────────┘              │
│  Branch that agent worktrees check out from.       │
│                                                    │
│  Worktree Location                                 │
│  ┌──────────────────────────────────┐              │
│  │ ~/.solo/worktrees            📁  │              │
│  └──────────────────────────────────┘              │
│                                                    │
│  Post-Create Commands                              │
│  ┌──────────────────────────────────┐              │
│  │ bun install                      │              │
│  │ bun run gen:bindings             │              │
│  └──────────────────────────────────┘              │
│                                                    │
│  Auto-Cleanup                                      │
│  [✓] Delete worktree when issue marked "Done"      │
│  [✓] Keep remote branch on GitHub                  │
│  Max worktrees: [ 5 ]                              │
│                                                    │
└────────────────────────────────────────────────────┘
```

**Store changes** — add to `settingsStore.ts`:
```typescript
automation: {
  baseBranch: string;          // default: 'main'
  worktreeLocation: string;    // default: '~/.solo/worktrees'
  setupCommands: string[];     // default: ['bun install']
  autoCleanup: boolean;        // default: true
  keepRemoteBranch: boolean;   // default: true
  maxWorktrees: number;        // default: 5
}
```

#### 2B: Issue Picker Panel (UI)

**File**: `src/components/panels/IssuePanel.tsx` (new panel)

A panel that shows GitHub issues (fetched via `gh` CLI or GitHub API) with:
- List of open issues with labels, assignees, priority
- "Start Working" button per issue → creates worktree + agent session
- Status indicators: Triage → In Progress → In Review → Done
- Filter by label, assignee, priority

**Workflow when user clicks "Start Working"**:
1. Reads `automation.baseBranch` from settings
2. Calls `worktree_create({ branch: "claude/fix-42-desc", base: baseBranch, create_branch: true })`
3. Calls `worktree_set_active(id)` → switches file explorer + git context
4. Calls `worktree_bind_agent(id, sessionId)`
5. Starts agent session in the worktree (existing `startAgentInWorktree()`)
6. Updates Linear ticket status to "In Progress" (via Linear MCP)

#### 2C: Issue Lifecycle Manager (Rust Backend)

**File**: `src-tauri/src/issue_commands.rs` (new command file)

New Tauri commands:
- `issue_start_work(issue_number, base_branch?)` — orchestrates worktree creation + agent binding
- `issue_mark_done(issue_number)` — cleanup:
  1. Push branch to remote (if not already pushed)
  2. Unbind agent from worktree
  3. Remove worktree from disk (`worktree_remove`)
  4. Keep branch on GitHub (no `git push --delete`)
  5. Update Linear status to "Done" (via GraphQL or emit event for frontend)
- `issue_get_status(issue_number)` — returns current lifecycle state

**State**: `IssueState` managed in `lib.rs`:
```rust
pub struct IssueState {
    pub active_issues: RwLock<HashMap<u64, IssueWorkSession>>,
}

pub struct IssueWorkSession {
    pub issue_number: u64,
    pub worktree_id: String,
    pub agent_session_id: Option<String>,
    pub status: IssueWorkStatus,  // Triage | InProgress | InReview | Done
    pub base_branch: String,
    pub created_at: u64,
}
```

#### 2D: Feedback Loop (Agent ↔ User Communication)

When the agent works on an issue locally:

1. **Plan Phase**: Agent reads issue, explores codebase, posts implementation plan in UI
2. **User Approval**: User reviews plan in Solo IDE, clicks "Approve" or provides feedback
3. **Implementation**: Agent implements in worktree, streams progress via events
4. **Verification**: Agent runs checks (cargo check, clippy, typecheck), reports results
5. **PR Creation**: Agent pushes branch + creates PR via `gh pr create`
6. **Status Update**: Issue status moves to "In Review"
7. **Done**: User reviews PR, merges, marks "Done" → worktree auto-deleted, branch stays on GitHub

---

## PART 3: Edge Cases, Corner Cases & Efficiency Critique

### 3.1 GitHub Actions: Concurrency & Race Conditions

| Risk | Severity | Mitigation |
|------|----------|------------|
| Two issues labeled `claude` simultaneously → both runs collide | High | Use `concurrency: group: claude-implement-${{ github.event.issue.number }}` + global `max-parallel: 2` |
| Concurrent PRs modify same files → merge conflicts | High | Before pushing, rebase onto latest `main`. If conflicts, label `needs-rebase` |
| Infinite review loop (review bot → agent responds → review bot again) | High | Skip reviews on PRs by `claude[bot]`. Max 2 review-response cycles, then hand off to human |
| Webhook delivery failure → issue sits in limbo | Medium | GitHub retries 3x. Add weekly "catch-up" workflow scanning `claude` issues without PRs |

### 3.2 GitHub Actions: Failures & Reliability

| Risk | Severity | Mitigation |
|------|----------|------------|
| Agent fails mid-implementation → dangling branch | Medium | `post:` cleanup step deletes branch if job fails. Weekly cron deletes `claude/*` branches with no PR |
| CI checks fail on agent's PR | High | Agent runs checks locally before PR. Self-repair up to 3 attempts. Then label `needs-human-fix` |
| Vague issue body → garbage implementation | Medium | Triage validates issue quality (min length, structured fields). Add `claude-needs-clarification` label path |
| Agent modifies files outside scope | Medium | `--allowedTools` restricts paths. Post-diff audit: if unexpected files changed, flag for review |
| Retry logic absent | Medium | Track retry count in labels (`claude-attempt-N`). After 3 fails → `claude-failed` label |

### 3.3 GitHub Actions: Cost & Efficiency

| Risk | Severity | Mitigation |
|------|----------|------------|
| Cold start: 3-5 min installing system deps + Rust + bun | Medium | Aggressive caching (`actions/cache`), `sccache` for Rust. Consider custom Docker image |
| API cost: 50K-200K tokens per issue ($1-$15/issue at Opus pricing) | High | Per-issue token budget. Use Haiku for triage, Sonnet for implementation. Log + monitor costs |
| Context window limit: large codebase exceeds window | Medium | Focused context via CLAUDE.md. Search tools (Grep/Glob) over bulk reads. Pre-computed codebase summary |
| GitHub Actions minutes: 10-60 min/issue × 100/month = $8-$48+ | Low | Caching reduces build time. `timeout-minutes: 30` cap. Self-hosted runners for heavy loads |
| Redundant codebase reads across issues | Low | Project CLAUDE.md provides persistent structural context. Cache analysis between runs |

### 3.4 Security: Critical Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Prompt injection via issue body** | **CRITICAL** | Never run agent in `approve-all` mode. Strict tool allowlist. Path restrictions. Sandbox execution |
| **Agent executing destructive commands** (`rm -rf`, `push --force`) | **CRITICAL** | Strict Bash allowlist: only `cargo`, `bun`, `git status/diff/add/commit/push`. Block `--force`, `reset --hard`, `clean -f` |
| **API key exposure in git URLs** (`git_commands.rs` embeds token in URL) | **HIGH** | Use `git credential-store` instead. Set `GIT_TRACE=0`. Audit all log statements |
| Agent reading sensitive files (`.env`, `*.key`, `*.pem`) | High | Deny-list in agent bridge: intercept `Read` calls, block sensitive paths |
| Supply chain: agent running `bun add malicious-pkg` | High | Block `bun add`/`cargo add` commands. Dependency changes only proposed in PR, not executed |
| ANTHROPIC_API_KEY compromise | High | Scoped keys with rate limits. Monthly rotation. Usage alerts. GitHub secret scanning |
| Agent accessing credentials in git remote URLs | Medium | Use SSH keys or credential helpers instead of embedded tokens |

### 3.5 Linear Sync Edge Cases

| Risk | Severity | Mitigation |
|------|----------|------------|
| Linear and GitHub lose sync (outage, token expiry) | Medium | Designate GitHub as source of truth. Daily reconciliation job. Monitor sync health |
| Simultaneous edits on both sides → last-write-wins | Low | Policy: requirements in Linear, implementation in GitHub. Consider one-way description sync |
| Linear API rate limits (~1,500 req/hr) | Low | Batch with GraphQL. Cache locally. Use webhooks over polling |
| Label mapping drift (renamed on one side) | Low | Canonical `linear-labels.json` config. Weekly audit |

### 3.6 Local Worktree: Crash Recovery

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Agent crash leaves locked worktree** (process killed, API error, OOM) | **HIGH** | Heartbeat mechanism: agent confirms alive every 30s. Auto-unbind after 2min silence. On startup: scan for locked worktrees with dead sessions |
| **IDE close while agent running** (Cmd+Q) | **HIGH** | Tauri `on_exit` handler unbinds all agent sessions. Save session state to disk for resume. On startup: detect orphaned locks, offer cleanup |
| Orphaned worktrees from SIGKILL | High | Store agent PID in worktree metadata. On startup: check if PID alive. `prune_orphaned` function for locked worktrees with dead sessions |
| Git lock file contention after crash | Medium | Reduce lock age threshold. Check locks before creation. `worktree_force_cleanup` command |
| Config file corruption (`worktrees.json`) | Medium | **Atomic writes** (write temp → rename). Keep `.backup` copy. JSON schema validation on load |

### 3.7 Local Worktree: Resource Management

| Risk | Severity | Mitigation |
|------|----------|------------|
| Disk space exhaustion (each worktree = repo + node_modules) | Medium | Check available disk before creation. Show usage per worktree. "Compact" button removes `node_modules` + `target/` from inactive worktrees. Bun hardlinks |
| 5+ worktrees × multi-GB = OS swap | Medium | Default `maxWorktrees: 5`. Warn at threshold. Auto-prune oldest inactive worktrees |
| File watcher storms during `bun install` in worktree | Low | Ignore `node_modules/`, `target/`, `.git/` in watcher. Suppress events during setup commands |
| `target/` dir per worktree → redundant compilation | Medium | Shared `CARGO_TARGET_DIR` or `sccache`. Careful with concurrent builds |
| Setup command time (`bun install` 30-60s per worktree) | Low | Use bun's global cache. Only run if `package.json` changed. `--frozen-lockfile` |

### 3.8 Local Worktree: Operational Edge Cases

| Risk | Severity | Mitigation |
|------|----------|------------|
| Two agents on same issue → duplicate work, branch conflicts | Medium | Check for existing worktree/agent for same issue before creating. Use issue-specific naming |
| Base branch deleted or doesn't exist locally | Medium | Validate base exists before creation. Fetch from remote if missing. Clear error: "Branch 'develop' not found" |
| Submodules not initialized in worktree | Low | Add `git submodule update --init` to default setup commands. Detect `.gitmodules` |
| Rapid worktree switching → lock contention, UI flicker | Low | Debounce switching (500ms min). Cancel pending file tree loads. Loading indicator |
| User has uncommitted changes in main workspace | Low | Already handled: atomic workspace swap saves original root. Add warning banner about unsaved editor buffers |

### 3.9 UX Concerns

| Risk | Severity | Mitigation |
|------|----------|------------|
| User confused by worktree context switch | Medium | Prominent banner: "Viewing branch claude/issue-42. Main workspace safe." Always-visible "Return to main" button. First-use tooltip |
| Notification fatigue (10+ comments per issue) | Medium | Consolidate: one comment at triage, one at PR. Collapsible `<details>` for verbose output |
| Agent plan is wrong, user doesn't catch it | Medium | Mandatory plan review gate for features. Configurable per-severity (auto for `low`, gate for `high`) |
| Can't tell which worktree = which issue | Low | Display issue title + number alongside worktree. "Go to issue" link |
| User wants to manually edit agent's worktree | Low | "Pause agent" button → suspends agent, unlocks worktree. Resume after edits |
| No visibility into agent progress | Medium | Stream progress events (already implemented). Step counter: "3/8 tools executed". Time elapsed indicator |

### 3.10 Additional Unconsidered Scenarios

| Scenario | Mitigation |
|----------|------------|
| Protected branch rules prevent agent from pushing | Always create PRs, never push to protected branches. No bypass permissions |
| Large PRs (500+ lines) overwhelm reviewers | Limit PR size. Split into multiple PRs. "Key changes" summary at top |
| Stale agent knowledge (new APIs, changed patterns) | Keep CLAUDE.md updated. Include recent commit history in context |
| Network outage halts all automation | Queue issues for later. Status indicator for API connectivity |
| GitHub Actions token permissions insufficient | Explicit `permissions:` block: `contents: write`, `pull-requests: write`, `issues: write` |
| Agent creates compile-correct but runtime-buggy code | Require integration tests. Human review remains final gate |
| Repo size grows → slow clone times | `git clone --depth 1` for CI. Shallow worktrees |

---

## PART 4: Critical Risk Priorities

| Priority | Risk | Category | Action Required |
|----------|------|----------|-----------------|
| **P0** | Prompt injection via issue body | Security | Strict tool allowlist + path restrictions in all workflows |
| **P0** | Destructive commands in CI | Security | Explicit Bash allowlist, no `rm`, `--force`, `reset --hard` |
| **P0** | API key in git URLs | Security | Refactor `git_commands.rs` to use credential helpers |
| **P1** | Race conditions on simultaneous labels | Concurrency | `concurrency` groups + `max-parallel` in workflows |
| **P1** | Agent crash → locked worktrees | Reliability | Heartbeat + startup recovery + `prune_orphaned` |
| **P1** | Infinite review loop | Reliability | Author check + max cycle limit |
| **P1** | Unbounded API costs | Cost | Per-issue token budgets + model tiering |
| **P2** | Plan review gate missing | UX | Feature issues require `claude-approved` |
| **P2** | CI cold start time | Efficiency | Docker image + sccache + aggressive caching |
| **P2** | Config corruption | Reliability | Atomic writes + backup for `worktrees.json` |
| **P3** | Notification fatigue | UX | Consolidated comments + collapsible sections |
| **P3** | Disk overhead | Resources | Max worktrees + compact inactive + bun hardlinks |

---

## Files to Create/Modify

### Cloud (GitHub Actions)
| File | Action |
|------|--------|
| `.github/workflows/claude-triage.yml` | CREATE |
| `.github/workflows/claude-implement.yml` | CREATE |
| `.github/workflows/claude-review.yml` | CREATE |
| `.github/workflows/claude-interactive.yml` | CREATE |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | CREATE |
| `.github/ISSUE_TEMPLATE/feature_request.yml` | CREATE |
| `CLAUDE.md` (in Solo-UDE/solo repo) | MODIFY — add CI Agent Context section |

### Local (Solo IDE) — Future Phase
| File | Action |
|------|--------|
| `crates/solo-protocol/src/lib.rs` | MODIFY — add `IssueWorkSession`, `IssueWorkStatus` types |
| `apps/desktop/src-tauri/src/issue_commands.rs` | CREATE — issue lifecycle commands |
| `apps/desktop/src-tauri/src/lib.rs` | MODIFY — register IssueState + commands |
| `apps/desktop/src/lib/tauri/issue.ts` | CREATE — IPC wrappers |
| `apps/desktop/src/stores/settingsStore.ts` | MODIFY — add `automation` settings |
| `apps/desktop/src/stores/issueStore.ts` | CREATE — issue work session store |
| `apps/desktop/src/components/settings/AutomationSettings.tsx` | CREATE |
| `apps/desktop/src/components/panels/IssuePanel.tsx` | CREATE |
| `apps/desktop/src/hooks/useIssueStream.ts` | CREATE — event listener |

### Safety Improvements (Recommended)
| File | Action |
|------|--------|
| `crates/solo-git/src/config.rs` | MODIFY — atomic writes + backup |
| `apps/desktop/src-tauri/src/worktree_commands.rs` | MODIFY — crash recovery, orphan detection |
| `apps/desktop/src-tauri/src/git_commands.rs` | MODIFY — remove token from URL, use credential helper |

### Documentation
| File | Action |
|------|--------|
| `solo/docs/AUTOMATION-PIPELINE.md` | CREATE — this plan document |

---

## Required Secrets

| Secret | Where | Purpose |
|--------|-------|---------|
| `ANTHROPIC_API_KEY` | GitHub repo secrets | Claude Code API for Actions |
| `GITHUB_TOKEN` | Automatic in Actions | GitHub API access |

---

## Implementation Order

**Week 1**: Part 1 (Cloud automation — GitHub Actions + Linear sync + labels + CLAUDE.md)
**Week 2**: Part 2A-2B (Automation settings UI + Issue picker panel)
**Week 3**: Part 2C-2D (Issue lifecycle Rust backend + feedback loop)
**Week 4**: Safety improvements (atomic writes, crash recovery, credential handling)

---

## Verification

1. **Linear sync**: Create GitHub issue → appears in Linear within seconds
2. **Triage**: New issue gets auto-labeled within ~2 minutes
3. **Implement (bug)**: Label issue `claude` + `bug` → PR created automatically
4. **Implement (feature)**: Label issue `claude` + `feature` → plan posted, waits for `claude-approved`
5. **Review**: Open a PR → review comment appears (no infinite loop)
6. **Interactive**: Comment `@claude explain this function` → response posted
7. **Concurrency**: Label 2 issues simultaneously → both handled, no conflicts
8. **Security**: Create issue with prompt injection → agent stays within tool allowlist
9. **Local worktree**: Click "Start Working" on issue → worktree created, agent starts
10. **Lifecycle**: Mark "Done" → worktree deleted, branch preserved on GitHub
11. **Crash recovery**: Kill IDE → restart → orphaned worktrees detected and offered for cleanup
12. **Cost**: Monitor token usage per issue stays within budget
