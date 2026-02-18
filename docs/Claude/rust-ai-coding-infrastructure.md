# Building AI-Coding Infrastructure for a Rust IDE

How we configured Solo IDE's Rust codebase so AI tools write idiomatic, correct code on the first try — inspired by [Coding Rust with Claude Code and Codex](https://tigran.tech/coding-rust-with-claude-code-and-codex/).

---

## The Insight: Rust's Compiler Is Your Best AI Reviewer

The core thesis from Tigran's article resonated with our experience: **Rust's compiler acts as an automatic expert reviewer for every edit an AI tool makes.**

In dynamic languages, AI-generated code can look perfectly reasonable, pass a quick review, and then fail in production. Rust eliminates entire classes of those failures. When Claude Code generates a function that violates ownership rules, the compiler responds with an exact error code (E0502), the precise source location, a clear explanation, and often a suggested fix. The AI parses this, applies the correction, and moves on — all without human intervention.

This creates a tight feedback loop: generate code, run `cargo check`, parse errors, restructure, repeat. The AI handles the mechanical parts — which combination of `&`, `Arc`, `RwLock`, and lifetime annotations makes the borrow checker happy — while the developer focuses on architecture and logic.

But this loop only works well if the AI knows **your** project's conventions. That's where infrastructure comes in.

---

## What We Built

We took Tigran's recommendations and applied them systematically to Solo IDE, a Tauri 2 desktop application with 7 Rust crates. Here's what we implemented and why.

### 1. A Comprehensive CLAUDE.md

The original `CLAUDE.md` covered the basics — commands, monorepo layout, IPC patterns. But it was missing the Rust-specific guidance that AI tools need to write code that matches the project's style:

**What we added:**

- **Error Handling Patterns** — Solo uses a two-tier system: `thiserror` domain errors internally (`FsError`, `ProviderError`, `EmbeddingError`), converted to `Result<T, String>` at the Tauri IPC boundary. We documented this explicitly because without it, AI tools default to `anyhow` or raw `String` errors.

- **Async Runtime Conventions** — Tokio 1.43 with Tauri managing the runtime. We documented the cancellation pattern (`watch::channel`), the tool approval pattern (`oneshot`), and the critical exception: PTY code uses `std::thread::spawn` because `portable-pty` is a blocking C library.

- **Memory Management Rules** — The single most important rule: *never hold async lock guards across `.await`*. We documented when to use `tokio::sync::RwLock` vs `std::sync::RwLock`, and the `Arc<RwLock<T>>` pattern for spawned tasks.

- **Serde Conventions** — Solo uses different serde tagging strategies for different types: internally tagged for `ContentBlock`, adjacently tagged for `BackendEvent`. Without documenting this, AI tools guess wrong and generate code that silently fails at deserialization.

- **Testing Conventions** — Inline `#[cfg(test)]` modules only, `#[tokio::test]` for async, `tempfile::TempDir` for filesystem tests.

- **Logging** — `tracing` with structured fields. Import only the macros you use — unused `tracing` imports now trigger clippy errors.

- **AI Workflow** — An explicit verification checklist: `cargo check`, `cargo clippy -- -D warnings`, `cargo fmt --check`, `cargo test`. This gives AI tools a concrete definition of "done."

### 2. Clippy Pedantic with Curated Allows

Following Tigran's advice to "run clippy aggressively with all lints enabled," we enabled `clippy::pedantic` across all 7 crates. But pedantic out of the box generates hundreds of warnings in an established codebase. The key was **curating the allow list**.

We categorized every pedantic lint into three buckets:

1. **Keep enforced** — lints that catch real bugs or suggest genuine improvements (e.g., `redundant_closure`, `implicit_saturating_sub`, dead code warnings)
2. **Allow globally** — lints that are purely style preferences and don't indicate bugs (e.g., `uninlined_format_args`, `single_match_else`, `doc_markdown`)
3. **Allow per-crate** — lints specific to Tauri's patterns (e.g., `too_many_arguments` for commands with `AppHandle + State + params`)

The result: `cargo clippy --workspace -- -D warnings` passes clean, and new code gets meaningful feedback from ~40 enforced pedantic lints.

We also tuned `clippy.toml` thresholds for this codebase:

```toml
cognitive-complexity-threshold = 30   # agentic loops are inherently complex
too-many-lines-threshold = 120
too-many-arguments-threshold = 9      # Tauri commands have many params
```

### 3. Rustfmt Configuration

We created a `rustfmt.toml` that codifies the actual code style (4-space indentation, 100 char width) and ran `cargo fmt --all` to normalize the entire codebase. This means AI-generated code that passes `cargo fmt --check` is guaranteed to match the project style.

### 4. GitHub Actions CI

Three parallel jobs that enforce everything:

1. **rust-check** — `cargo check` + `cargo fmt --check` + `cargo clippy -- -D warnings`
2. **rust-test** — `cargo test --workspace --lib` (depends on rust-check)
3. **ts-check** — `bun install` + TypeScript typecheck (independent)

The CI runs on `paths: ['solo/**']` so it only triggers on Solo changes. The desktop crate is excluded from clippy/test because `tauri::generate_context!()` requires the frontend `dist` directory.

---

## The Fixes: What Clippy Caught

Enabling pedantic across the workspace surfaced ~100 warnings in existing code. Here's what the meaningful ones taught us:

- **`redundant_closure`** (12 instances) — `.map_err(|e| FsError::Io(e))` became `.map_err(FsError::Io)`. Simpler, more idiomatic.

- **`format!` appended to String** (9 instances) — `result.push_str(&format!("..."))` wastes an allocation. Replaced with `write!(result, "...")` using `std::fmt::Write`.

- **`lazy_static!` superseded** — Replaced with `std::sync::LazyLock`, removing the `lazy_static` dependency entirely.

- **`implicit_saturating_sub`** — Manual `if now >= expires_at { 0 } else { expires_at - now }` replaced with `expires_at.saturating_sub(now)`.

- **Dead code fields** — API response structs with deserialized fields that were never read. Annotated with `#[allow(dead_code)]` since the fields are intentionally populated by serde.

- **Unused async** — Three functions marked `async` with no `.await` inside. Removed the `async` keyword.

- **Unchecked Duration subtraction** — `now - Duration::from_secs(60)` can panic if `now` is less than 60 seconds old. Changed to `now.checked_sub(Duration::from_secs(60)).unwrap_or(now)`.

---

## Results

After this work:

| Check | Status |
|-------|--------|
| `cargo fmt --all -- --check` | Pass |
| `cargo clippy --workspace --exclude solo-desktop -- -D warnings` | Pass |
| `cargo test --workspace --lib --exclude solo-desktop` | 38/38 pass |

**For AI tools specifically:**
- Claude Code can now look at `CLAUDE.md` and know exactly how to structure errors, handle async, manage locks, and tag serde enums
- Every Rust change gets validated by pedantic clippy before the developer sees it
- CI ensures no regression — AI tools can verify their work automatically

---

## The Learning Curve Trade-Off

Tigran's article makes an important observation: while Rust has a steep learning curve, AI tools excel at handling ownership and borrowing. The developer concentrates on architecture; the AI figures out which combination of `&`, `Arc`, `RwLock`, and lifetime annotations makes the code compile.

Our experience confirms this. The most productive pattern is:

1. **Human decides** the function signature and error types
2. **AI generates** the implementation
3. **Compiler verifies** memory safety and type correctness
4. **Clippy refines** style and catches subtle issues
5. **Human reviews** logic and architecture

The infrastructure we built — `CLAUDE.md`, clippy pedantic, rustfmt, CI — makes step 2 dramatically more likely to produce correct code on the first attempt, and makes steps 3-4 automatic.

---

## Files Changed

| File | Description |
|------|-------------|
| `solo/CLAUDE.md` | Added 7 new Rust-specific sections |
| `solo/clippy.toml` | Tuned thresholds for this codebase |
| `solo/rustfmt.toml` | Codified actual code style |
| `solo/crates/*/src/lib.rs` (7 files) | Added pedantic lint attributes |
| `.github/workflows/ci.yml` | Three-job CI pipeline |
| `.claude/skills/solo-rust-ai-skill/` | Reusable skill for AI Rust coding |
| ~40 Rust source files | Fixed clippy warnings |

---

## References

- [Coding Rust with Claude Code and Codex](https://tigran.tech/coding-rust-with-claude-code-and-codex/) — the article that inspired this work
- [Clippy Lint Reference](https://rust-lang.github.io/rust-clippy/master/index.html)
- [Tauri 2 Commands](https://v2.tauri.app/develop/calling-rust/)
