# Multi-Provider AI Support Implementation for Solo IDE

## Overview

This document describes the implementation of multi-provider AI support for Solo IDE, allowing users to configure and switch between Anthropic/Claude and OpenAI providers.

## Implementation Date

January 25, 2026

## Architecture

### Rust Backend (Tauri)

```
solo/
├── crates/
│   └── solo-agent/              # NEW: Multi-provider agent crate
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs           # AgentManager, AgentSession
│           ├── provider.rs      # AIProvider trait, ProviderType, ProviderError
│           ├── models.rs        # Model registry (Claude, GPT-4.1, o3, etc.)
│           ├── credentials.rs   # Keychain + env var credential storage
│           ├── anthropic.rs     # Anthropic/Claude implementation
│           └── openai.rs        # OpenAI implementation
│
└── apps/desktop/src-tauri/
    └── src/
        ├── commands.rs          # MODIFIED: Added provider/agent commands
        └── lib.rs               # MODIFIED: Registered new commands
```

### TypeScript Frontend

```
solo/apps/desktop/src/
├── bindings/
│   └── index.ts                 # NEW: TypeScript type definitions
├── lib/
│   └── backend.ts               # MODIFIED: Added provider/agent API functions
└── stores/
    └── provider-store.ts        # NEW: Zustand store for provider state
```

## Files Created

### Rust Crate: `solo-agent`

| File | Purpose |
|------|---------|
| `crates/solo-agent/Cargo.toml` | Package manifest with dependencies |
| `crates/solo-agent/src/lib.rs` | Main entry: `AgentManager`, `AgentSession` |
| `crates/solo-agent/src/provider.rs` | `AIProvider` trait, `ProviderType`, errors |
| `crates/solo-agent/src/models.rs` | Model registry with capabilities |
| `crates/solo-agent/src/credentials.rs` | Keychain + env var credential storage |
| `crates/solo-agent/src/anthropic.rs` | Anthropic streaming implementation |
| `crates/solo-agent/src/openai.rs` | OpenAI streaming implementation |

### TypeScript

| File | Purpose |
|------|---------|
| `apps/desktop/src/bindings/index.ts` | TypeScript type definitions |
| `apps/desktop/src/stores/provider-store.ts` | Zustand provider state store |

## Files Modified

| File | Changes |
|------|---------|
| `crates/solo-protocol/src/lib.rs` | Added `ProviderType`, `ProviderStatus`, `ModelInfo`, updated `AgentSendMessageRequest` |
| `apps/desktop/src-tauri/Cargo.toml` | Added `solo-agent` and `uuid` dependencies |
| `apps/desktop/src-tauri/src/commands.rs` | Added provider and agent commands |
| `apps/desktop/src-tauri/src/lib.rs` | Registered new commands with state management |
| `apps/desktop/src/lib/backend.ts` | Added provider and agent API functions |

## Key Types

### ProviderType

```rust
pub enum ProviderType {
    Anthropic,
    OpenAI,
}
```

### AIProvider Trait

```rust
#[async_trait]
pub trait AIProvider: Send + Sync {
    fn provider_type(&self) -> ProviderType;
    async fn send_message(...) -> ProviderResult<mpsc::Receiver<BackendEvent>>;
    fn available_models(&self) -> Vec<String>;
    async fn validate_credentials(&self) -> ProviderResult<bool>;
    fn set_tools(&mut self, tools: Vec<ToolDefinition>);
    fn get_tools(&self) -> &[ToolDefinition];
}
```

### Credential Storage Priority

1. **macOS Keychain** - Service name: `solo.provider.{anthropic|openai}.apiKey`
2. **Claude Code OAuth** - For Anthropic only, reads from Claude Code's Keychain entry
3. **Environment Variables** - `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`

## Model Support

### Anthropic Models
- `claude-sonnet-4-20250514` (sonnet) - Default
- `claude-opus-4-20250514` (opus)
- `claude-3-5-haiku-latest` (haiku)

### OpenAI Models
- `gpt-4.1` - Default (1M context, coding-focused)
- `gpt-4.1-mini` - Smaller/faster variant
- `o3` - Advanced reasoning model
- `o4-mini` - Fast reasoning model
- `gpt-4o` - Multimodal model

## Tauri Commands

### Provider Commands

| Command | Description |
|---------|-------------|
| `get_providers` | Get list of available providers |
| `get_active_provider` | Get currently active provider |
| `set_active_provider` | Set the active provider |
| `get_provider_status` | Get status info for a provider |
| `has_credentials` | Check if provider has credentials |
| `set_credentials` | Store credentials for a provider |
| `get_models` | Get available models (optionally by provider) |

### Agent Commands

| Command | Description |
|---------|-------------|
| `agent_send_message` | Send message to AI agent (returns conversation ID) |
| `create_session` | Create a new conversation session |

## Frontend Usage

### Initialize Provider Store

```typescript
import { useProviderStore } from "./stores/provider-store";

// In App component or initialization
useEffect(() => {
  useProviderStore.getState().initialize();
}, []);
```

### Send Agent Message

```typescript
import { sendAgentMessage, listenBackendEvents } from "./lib/backend";

// Set up event listener
const unlisten = await listenBackendEvents((event) => {
  switch (event.type) {
    case "agent:chunk":
      // Handle streaming text
      break;
    case "agent:tool_start":
      // Handle tool call start
      break;
    case "agent:complete":
      // Handle message completion
      break;
    case "agent:error":
      // Handle errors
      break;
  }
});

// Send message
const conversationId = await sendAgentMessage("Hello!", {
  provider: "Anthropic",
  model: "claude-sonnet-4-20250514",
});

// Cleanup
unlisten();
```

### Switch Providers

```typescript
import { useProviderStore } from "./stores/provider-store";

// In component
const { setActiveProvider, setCredentials } = useProviderStore();

// Set credentials
await setCredentials("OpenAI", "sk-...");

// Switch provider
await setActiveProvider("openai");
```

## Building

```bash
# From solo/ directory
cd solo

# Build all Rust crates
cargo build

# Generate TypeScript bindings (if using ts-rs export)
bun run gen:bindings

# Start dev server
bun run dev
```

## Testing

1. **Credentials:** Set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` env var
2. **Provider switching:** Use `setActiveProvider()` to change providers
3. **Message streaming:** Send a message and verify events stream correctly
4. **Tool use:** Test tool calling with both providers

## Next Steps

1. **Tool Execution:** Implement actual tool execution (Read, Write, Bash, etc.)
2. **Keychain UI:** Add settings UI for entering/managing API keys
3. **Model Picker:** Add UI component for selecting models
4. **Streaming UI:** Connect agent events to chat message rendering
5. **Error Handling:** Improve error messages and retry logic
