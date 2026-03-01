---
name: gen-bindings
description: Regenerate TypeScript bindings after modifying solo-protocol Rust types. Invoke whenever IPC types, BackendEvent variants, or ts-rs derives change in crates/solo-protocol/src/lib.rs.
---

# Generate TypeScript Bindings

When any Rust types in `crates/solo-protocol/src/lib.rs` are modified (structs, enums, BackendEvent variants), the TypeScript bindings must be regenerated.

## When to trigger

- Adding/modifying/removing a `#[derive(TS)]` struct or enum
- Changing `BackendEvent` variants
- Modifying any type used in `#[tauri::command]` return values or parameters
- After adding new types to `solo-protocol`

## Steps

1. Ensure the Rust code compiles:
   ```bash
   cargo check --workspace
   ```

2. Regenerate bindings:
   ```bash
   bun run gen:bindings
   ```

3. Verify the generated files in `apps/desktop/src/bindings/` reflect your changes.

4. **Never hand-edit files in `src/bindings/`** — they are auto-generated and will be overwritten.

## Common issues

- If `bun run gen:bindings` fails, check that all `#[derive(TS)]` types also derive `Serialize` and `Deserialize`.
- New types need `#[ts(export)]` attribute to be included in the output.
- Enum variants with `#[serde(tag = "type")]` generate tagged unions in TypeScript.
