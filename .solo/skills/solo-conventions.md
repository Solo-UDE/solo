---
name: solo-conventions
description: Solo IDE coding conventions - Tauri IPC, Zustand stores, component patterns
enabled: true
priority: 20
---

# Solo IDE Conventions

## IPC Pattern

1. Define types in `crates/solo-protocol/src/lib.rs` with `#[derive(TS, Serialize, Deserialize)]`
2. Write command in `apps/desktop/src-tauri/src/{domain}_commands.rs`
3. Register in `lib.rs` via `generate_handler![]`
4. Run `bun run gen:bindings`
5. Create TS wrapper in `src/lib/tauri/{domain}.ts`

## State Management

- Zustand stores with Immer middleware
- Use `Map` for O(1) lookups, `Set` for collections
- One store per domain: `src/stores/{domain}Store.ts`

## Component Structure

- Panel components in `src/components/panels/`
- Feature components in `src/components/{feature}/`
- Shared UI in `packages/ui/`

## Style

- Tailwind CSS v4 with OKLCH colors
- Shadows over borders
- 8-14px border radius
- 150-200ms transitions
