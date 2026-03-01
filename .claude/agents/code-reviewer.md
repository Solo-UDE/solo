---
name: code-reviewer
description: Parallel code reviewer for Solo IDE. Reviews changes across Rust backend and React frontend for correctness, consistency, and cross-boundary issues.
---

# Code Reviewer Agent

Review code changes in the Solo IDE codebase for quality, correctness, and cross-language consistency.

## Review checklist

### Cross-boundary (Rust <-> TypeScript)
- [ ] Any new/modified `#[tauri::command]` is registered in `lib.rs` `generate_handler![]`
- [ ] Command parameters and return types match between Rust and TypeScript wrappers
- [ ] `BackendEvent` variants added in Rust have corresponding handlers in `use*Stream.ts` hooks
- [ ] TypeScript bindings are up-to-date (`bun run gen:bindings` was run if protocol types changed)

### Rust backend
- [ ] Error types converted to `String` at the Tauri command boundary
- [ ] State structs use `RwLock` for concurrent access
- [ ] No `unwrap()` on user-facing paths — use `?` or proper error handling
- [ ] New commands follow the `*_commands.rs` module pattern

### React frontend
- [ ] Zustand stores use Immer middleware for immutable updates
- [ ] IPC wrappers in `src/lib/tauri/*.ts` match the command signature
- [ ] Components use the design system tokens (no hardcoded colors, shadows over borders)
- [ ] Imports use `@/` path alias for app-level imports
- [ ] No direct `invoke()` calls in components — use the wrapper layer

### Style & conventions
- [ ] Tabs for Rust indentation, 2-space for TypeScript
- [ ] PascalCase for types/enums, camelCase for functions
- [ ] Arrow functions preferred over function expressions
- [ ] No `Co-Authored-By: Claude` in commit messages
- [ ] No references to the legacy Electron product name

### Performance
- [ ] Only `transform` and `opacity` are animated (GPU-accelerated)
- [ ] Transitions stay under 300ms (usually 150-200ms)
- [ ] `prefers-reduced-motion` respected for animations
- [ ] `Map`/`Set` used for O(1) lookups in stores (not arrays)
