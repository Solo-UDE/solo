# Claude Project Instructions: Rust-Based AI Agentic UDE

Copy this into your Claude web project's custom instructions to get consistent, high-quality responses for building Solo IDE.

---

## Project Overview

You are helping build **Solo IDE**, a Rust-based AI-native Unified Development Environment. This is a desktop application that deeply integrates AI agents into every aspect of the development workflow.

### Core Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Solo IDE                                  │
├─────────────────────────────────────────────────────────────────┤
│  Frontend: React 19 + TypeScript 5.7 + Vite 6 + Tailwind CSS v4 │
├─────────────────────────────────────────────────────────────────┤
│  IPC Bridge: Tauri Commands (invoke/listen)                     │
├─────────────────────────────────────────────────────────────────┤
│  Backend: Rust + Tauri 2.2 + Tokio (async runtime)              │
├─────────────────────────────────────────────────────────────────┤
│  AI Layer: Claude Agent SDK / Custom Agents                      │
└─────────────────────────────────────────────────────────────────┘
```

### Key Technologies

| Layer | Technology | Purpose |
|-------|------------|---------|
| Frontend | React 19 | UI rendering with concurrent features |
| Styling | Tailwind CSS v4 | CSS-first config with `@theme` |
| Components | Radix UI + shadcn patterns | Accessible primitives |
| State | Zustand | Client state management |
| Editor | CodeMirror 6 | Code editing |
| Terminal | xterm.js | Embedded terminal |
| Backend | Rust + Tauri 2.2 | Native capabilities |
| Async | Tokio | Async Rust runtime |
| AI | Claude Agent SDK | AI agent integration |

---

## Response Guidelines

### When Writing Rust Code

1. **Use idiomatic Rust patterns:**
   - Prefer `Result<T, E>` over panics
   - Use `?` operator for error propagation
   - Implement proper error types with `thiserror`
   - Use `Arc<Mutex<T>>` for shared state across threads

2. **Tauri command pattern:**
```rust
#[tauri::command]
pub async fn my_command(
    arg: String,
    state: tauri::State<'_, AppState>,
) -> Result<Response, String> {
    // Implementation
    Ok(response)
}
```

3. **Async Rust with Tokio:**
```rust
use tokio::sync::mpsc;

pub async fn process_stream() -> Result<(), Error> {
    let (tx, mut rx) = mpsc::channel(32);

    tokio::spawn(async move {
        while let Some(item) = rx.recv().await {
            // Process item
        }
    });

    Ok(())
}
```

4. **State management:**
```rust
pub struct AppState {
    pub workspace: Arc<Mutex<Option<PathBuf>>>,
    pub agents: Arc<Mutex<HashMap<String, AgentHandle>>>,
}
```

### When Writing TypeScript/React Code

1. **Component structure:**
```tsx
import type { FC } from "react";

interface ComponentProps {
  title: string;
  onAction: () => void;
}

export const Component: FC<ComponentProps> = ({ title, onAction }) => {
  return (
    <div className="...">
      {/* content */}
    </div>
  );
};
```

2. **Zustand store pattern (no middleware):**
```typescript
import { create } from "zustand";

interface State {
  value: string;
}

interface Actions {
  setValue: (value: string) => void;
}

export const useStore = create<State & Actions>()((set) => ({
  value: "",
  setValue: (value) => set({ value }),
}));
```

3. **Tauri invoke wrapper:**
```typescript
import { invoke } from "@tauri-apps/api/core";

export async function myCommand(arg: string): Promise<Response> {
  return invoke<Response>("my_command", { arg });
}
```

### UI/UX Guidelines

Follow these design principles consistently:

1. **Shadows over borders** - Use soft shadows, avoid hard 1px borders
2. **Generous spacing** - 8-16px padding, breathing room
3. **Soft corners** - 8-14px border radius
4. **Subtle animations** - 150-200ms transitions, scale transforms
5. **Warm dark theme** - Stone colors (#1c1917 background, #6BBF59 primary light / #B5E48C primary dark)

**Button patterns:**
```tsx
// Primary
className="h-[34px] px-3.5 bg-primary text-primary-foreground rounded-[10px] font-medium hover:brightness-110 active:scale-[0.97] transition-all duration-200"

// Ghost
className="h-[34px] px-3 bg-transparent text-muted-foreground rounded-[10px] hover:bg-muted/60 hover:text-foreground hover:scale-[1.02] active:scale-[0.97] transition-all duration-200"
```

**Input pattern:**
```tsx
className="h-9 px-3 rounded-lg bg-muted/40 border-none text-foreground placeholder:text-muted-foreground/50 focus:bg-muted/60 focus:ring-1 focus:ring-ring/30 transition-all duration-200"
```

**Panel pattern:**
```tsx
className="bg-card/95 backdrop-blur-md rounded-[14px] shadow-[0_8px_32px_-8px_rgba(0,0,0,0.2)] border border-border/50"
```

### AI Agent Integration Patterns

1. **Agent lifecycle:**
```rust
pub struct Agent {
    id: String,
    status: AgentStatus,
    context: AgentContext,
}

pub enum AgentStatus {
    Idle,
    Thinking,
    Acting,
    WaitingForInput,
    Completed,
    Error(String),
}

impl Agent {
    pub async fn run(&mut self, task: Task) -> Result<AgentOutput, AgentError> {
        self.status = AgentStatus::Thinking;
        // Process with Claude API
        // Execute tools
        // Return result
    }
}
```

2. **Tool execution:**
```rust
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    async fn execute(&self, input: ToolInput) -> Result<ToolOutput, ToolError>;
}

pub struct FileReadTool;
pub struct FileWriteTool;
pub struct BashTool;
pub struct SearchTool;
```

3. **Streaming responses to UI:**
```rust
#[tauri::command]
pub async fn run_agent(
    window: tauri::Window,
    task: String,
) -> Result<(), String> {
    let (tx, mut rx) = mpsc::channel(32);

    // Spawn agent task
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            window.emit("agent-event", event).ok();
        }
    });

    Ok(())
}
```

```typescript
// Frontend listener
import { listen } from "@tauri-apps/api/event";

listen<AgentEvent>("agent-event", (event) => {
  // Update UI with streaming content
});
```

---

## Code Style Requirements

### Rust
- Use `rustfmt` defaults
- Prefer `snake_case` for functions/variables
- Use `PascalCase` for types/traits
- Document public APIs with `///` doc comments
- Handle all errors explicitly

### TypeScript
- Use tabs for indentation
- Prefer arrow functions `=>`
- Use `interface` over `type` for object shapes
- Export types explicitly with `export type`
- Use `FC` for functional components

### File Organization

```
src/
├── components/
│   ├── ui/           # Radix wrappers
│   ├── shared/       # Reusable primitives
│   ├── layout/       # Page structure
│   ├── editor/       # CodeMirror integration
│   ├── terminal/     # xterm integration
│   └── chat/         # AI chat interface
├── stores/           # Zustand stores
├── hooks/            # Custom React hooks
├── lib/              # Utilities, constants, backend wrappers
└── types/            # TypeScript types

src-tauri/
├── src/
│   ├── commands/     # Tauri commands
│   ├── agents/       # AI agent implementations
│   ├── tools/        # Agent tools
│   ├── state.rs      # App state
│   └── lib.rs        # Entry point
└── Cargo.toml
```

---

## Common Tasks

### Adding a new Tauri command

1. Define in Rust (`src-tauri/src/commands.rs`):
```rust
#[tauri::command]
pub async fn new_command(arg: String) -> Result<String, String> {
    Ok(format!("Result: {}", arg))
}
```

2. Register in `lib.rs`:
```rust
.invoke_handler(tauri::generate_handler![commands::new_command])
```

3. Create TypeScript wrapper (`src/lib/backend.ts`):
```typescript
export async function newCommand(arg: string): Promise<string> {
    return invoke<string>("new_command", { arg });
}
```

### Adding a new UI component

1. Create file in `src/components/ui/`
2. Follow shadcn pattern with Radix primitive
3. Use `cn()` helper for class merging
4. Export from component file
5. Use soft UI patterns (shadows, rounded corners, transitions)

### Adding a new store

1. Create file in `src/stores/`
2. Define State and Actions interfaces separately
3. Use pure Zustand (no middleware)
4. Export selector hooks for performance
5. Define default state for reset capability

---

## Don'ts

- Don't use `immer` middleware with Zustand (causes issues)
- Don't use hard 1px borders on containers
- Don't use uppercase labels
- Don't skip transitions (always animate)
- Don't use bright focus rings
- Don't make click targets smaller than 32px
- Don't use `unwrap()` in production Rust code
- Don't block the main thread with sync operations

---

## Reference Colors

```css
Background: #1c1917 (Stone 900)
Card:       #292524 (Stone 800)
Muted:      #44403c (Stone 700)
Border:     #57534e (Stone 600)
Primary:    #6BBF59 (Solo Green - light mode)
Primary:    #B5E48C (Solo Mint - dark mode)
Foreground: #fafaf9 (Stone 50)
```

---

## When Asked About...

**Architecture decisions:** Explain trade-offs, consider performance, maintainability, and the AI-native philosophy of the app.

**UI implementation:** Always follow the soft UI design system with shadows, rounded corners, and subtle animations.

**Rust patterns:** Use idiomatic async Rust with proper error handling, avoid panics.

**AI integration:** Design for streaming responses, tool execution, and multi-step agent workflows.

**State management:** Use Zustand without middleware, create selector hooks, keep stores focused.
