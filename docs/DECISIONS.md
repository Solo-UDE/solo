# Solo IDE - Decision Log

This document tracks architectural decisions with timestamps.

---

## 2026-01-25: Initial Architecture Decisions

### Framework Selection
- **Decision**: Tauri (Rust backend + webview frontend)
- **Rationale**: Rust-native, smaller bundle size (~10MB vs ~150MB Electron), direct Rust<->JS bridge, modern security model
- **Alternatives Considered**:
  - Electron + Rust sidecar (more mature but heavier)
  - Pure Rust UI (egui/iced - no JS, but steeper curve)

### AI Integration
- **Decision**: Claude Agent SDK patterns (via direct Anthropic API in Rust)
- **Rationale**: Proven patterns from Orbit IDE, native streaming support, tool execution framework
- **Note**: Claude Agent SDK is Node.js only - will implement equivalent in Rust using `anthropic` crate or direct API calls

### Build System
- **Decision**: Cargo workspaces (Rust) + Bun (TypeScript/React)
- **Rationale**: Cargo workspaces provide clean crate separation; Bun is fast and modern for JS tooling
- **Structure**: `/crates/*` for Rust, `/apps/desktop` for Tauri+React, `/packages/*` for shared TS

### MVP Priority
- **Decision**: Full code editor + terminal first, then AI
- **Rationale**: Solid foundation matters; terminal is core to any IDE; AI can be added incrementally
- **Phase Order**: Terminal → File System → AI Chat → Code Editor (LSP)

### UI Inspiration
- **Decision**: Follow Orbit-web's "warm aesthetic" design system
- **Key Patterns**:
  - Shadows over borders (soft elevation)
  - OKLCH color palette (warm, organic tones)
  - Spring-based animations (150-200ms, physics-based easing)
  - Tailwind CSS v4 + Radix UI primitives
  - Fluid typography using `clamp()`

---

## Future Decisions (To Be Made)

- [ ] Code editor library choice (Monaco vs CodeMirror vs custom)
- [ ] LSP client implementation strategy
- [ ] Plugin/extension system design
- [ ] Authentication & sync approach
- [ ] Distribution & auto-update strategy
