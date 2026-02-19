# How I Built a Desktop AI IDE That Uses Your Claude Subscription Instead of API Keys

**TL;DR:** I built Solo IDE, a Tauri 2 desktop app with a Rust backend and React frontend, that bridges to the Claude Agent SDK through a Node.js sidecar process. It uses your existing Claude subscription (OAuth) instead of pay-per-token API keys. The key insight: the Claude Agent SDK is Node.js-only, but your desktop app doesn't have to be. I'll show you exactly how I bridged Rust and Node.js with newline-delimited JSON over stdin/stdout, streamed real-time responses through Tauri's IPC to a React frontend, and wired up OAuth credentials from the macOS Keychain.

---

## The Problem: API Keys Are Expensive, You Already Pay for Claude

If you've built anything with Claude's API, you know the pain. Every request costs money. Extended thinking? More money. Long conversations with tool use? The bill adds up fast.

But here's the thing - you probably already have a Claude Pro or Team subscription. You're paying $20/month for unlimited-ish access through claude.ai and Claude Code CLI. What if your custom desktop app could use that same subscription?

That's exactly what Solo IDE does. When you log into Claude Code CLI once (`claude login`), it stores an OAuth token in your macOS Keychain. Solo reads that token and piggybacks on the same authentication - your custom app uses your subscription quota, not API credits.

The architecture to make this work is non-trivial. Let me walk you through every layer.

---

## Architecture Overview

```
+--------------------------------------------------+
|            Solo IDE (Tauri 2 Desktop App)         |
|                                                   |
|  +---------------------------------------------+ |
|  |   React 19 Frontend (Webview)                | |
|  |   - Zustand stores + Immer                   | |
|  |   - Message rendering pipeline               | |
|  |   - Tool approval dialogs                    | |
|  +---------------------------------------------+ |
|                    | Tauri IPC                     |
|                    | (invoke + emit)               |
|  +---------------------------------------------+ |
|  |   Rust Backend (Tauri Core)                  | |
|  |   - SessionManager (process lifecycle)       | |
|  |   - AgentBridge (stdin/stdout JSON IPC)      | |
|  |   - Bounded channels + reader thread         | |
|  +---------------------------------------------+ |
|                    | stdin/stdout                   |
|                    | (newline-delimited JSON)       |
|  +---------------------------------------------+ |
|  |   Agent Bridge (Node.js Sidecar)             | |
|  |   - @anthropic-ai/claude-agent-sdk           | |
|  |   - Session management & streaming           | |
|  |   - Permission handling                      | |
|  |   - OAuth credential reading                 | |
|  +---------------------------------------------+ |
+--------------------------------------------------+
```

Three layers. Three languages. One streaming pipeline.

---

## Layer 1: OAuth Credentials - Reading from the Keychain

The foundation of this whole approach is credential reuse. When you run `claude login` in your terminal, Claude Code CLI performs an OAuth flow and stores the resulting token in the macOS Keychain under the service name `"Claude Code-credentials"`.

The token is stored as a JSON blob:

```json
{
  "claudeAiOauth": {
    "accessToken": "sk-ant-oat-...",
    "expiresAt": "1708300800000"
  }
}
```

In the Node.js sidecar, I read this with a simple Keychain lookup:

```typescript
// agent-bridge/src/credentials.ts
function getOAuthTokenFromKeychain(): string | null {
  try {
    const output = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: 'utf-8' }
    ).trim();

    const parsed = JSON.parse(output);
    const claudeAuth = parsed.claudeAiOauth;

    if (!claudeAuth?.accessToken) return null;

    // Check expiration
    if (claudeAuth.expiresAt) {
      const expiryDate = new Date(parseInt(claudeAuth.expiresAt, 10));
      if (new Date() >= expiryDate) {
        return null; // Token expired
      }
    }

    return claudeAuth.accessToken;
  } catch {
    return null; // Not found or parsing error
  }
}
```

The critical trick is what happens when we detect an OAuth token is available:

```typescript
// In the agent's startSession() method
const credentials = ClaudeCredentials.getCredentials();

if (credentials.type === 'oauth') {
  // Clear API key env vars so the SDK spawns Claude CLI subprocess
  // The CLI subprocess reads OAuth token from Keychain internally
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
}
```

**Why delete the env vars?** The Claude Agent SDK has two auth modes. If `ANTHROPIC_API_KEY` is set, it makes direct API calls (pay-per-token). If no API key is present, the SDK spawns a Claude Code CLI subprocess that handles auth internally using the Keychain token. By clearing the env vars, we force the SDK into "CLI mode" which uses your subscription.

The fallback chain is simple:
1. Try OAuth token from Keychain (free - uses subscription)
2. Fall back to `ANTHROPIC_API_KEY` from `.env` (paid - uses API credits)

---

## Layer 2: The Node.js Sidecar - Why Not Just Use Rust?

The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) only exists as a Node.js package. There's no Rust equivalent. Rather than attempting a from-scratch Rust reimplementation of the entire agentic loop (tool execution, permission handling, context management, streaming), I chose a **sidecar pattern**: Rust spawns a Node.js process and communicates with it over stdin/stdout using newline-delimited JSON.

### The IPC Protocol

Every message between Rust and Node.js is a single line of JSON followed by `\n`. There are three message categories:

**Requests** (Rust -> Node.js): Commands like "create session", "send message", "interrupt"

```typescript
// protocol.ts - Request types
export type BridgeRequest =
  | { type: 'create_session'; sessionId: string; config?: SessionConfig }
  | { type: 'send_message'; sessionId: string; message: string }
  | { type: 'interrupt'; sessionId: string }
  | { type: 'permission_response'; response: PermissionResponse }
  | { type: 'set_thinking_mode'; sessionId: string; enabled: boolean }
  | { type: 'set_model'; sessionId: string; model: 'haiku' | 'sonnet' | 'opus' }
  | { type: 'shutdown' }
  // ... more
```

**Command Responses** (Node.js -> Rust): Synchronous replies to requests

```typescript
export type CommandResponse =
  | { type: 'success'; requestType: string }
  | { type: 'error'; requestType: string; error: string }
  | { type: 'boolean'; requestType: string; value: boolean }
  | { type: 'string'; requestType: string; value: string | null }
```

**Events** (Node.js -> Rust): Unsolicited streaming data

```typescript
export type BridgeEvent =
  | { type: 'agent_message'; sessionId: string; message: AgentMessage }
  | { type: 'permission_request'; request: PermissionRequest }
  | { type: 'session_init'; event: SessionInitEvent }
  | { type: 'ready' }
  // ... more
```

Both responses and events flow through the same stdout pipe. The Rust side distinguishes them by the `type` field.

### The Entry Point

The Node.js sidecar is dead simple:

```typescript
// agent-bridge/src/index.ts
function main(): void {
  const sessionManager = new SessionManager();

  // Wire event handlers -> stdout
  sessionManager.onAgentMessage((data) => {
    sendEvent({ type: 'agent_message', sessionId: data.sessionId, message: data.message });
  });
  sessionManager.onPermissionRequest((request) => {
    sendEvent({ type: 'permission_request', request });
  });

  // Read requests from stdin
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    const request = JSON.parse(line) as BridgeRequest;
    handleRequest(request, sessionManager).catch((error) => {
      sendResponse({ type: 'error', requestType: request.type, error: error.message });
    });
  });

  // Signal ready
  sendEvent({ type: 'ready' });
}

function sendMessage(message: BridgeResponse): void {
  process.stdout.write(JSON.stringify(message) + '\n');
}
```

### The Claude Agent SDK Integration

The `OrbitAgent` class wraps the SDK's `query()` function with a streaming input pattern. Instead of sending one message and waiting for a response, it creates a **message queue** backed by an async iterator:

```typescript
class MessageQueue {
  private queue: SDKUserMessage[] = [];
  private resolvers: ((value: IteratorResult<SDKUserMessage>) => void)[] = [];

  add(message: string): void {
    const sdkMessage = { type: 'user', message: { role: 'user', content: message } };
    if (this.resolvers.length > 0) {
      this.resolvers.shift()!({ value: sdkMessage, done: false });
    } else {
      this.queue.push(sdkMessage);
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    while (!this.stopped) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else {
        const result = await new Promise<IteratorResult<SDKUserMessage>>(
          (resolve) => this.resolvers.push(resolve)
        );
        if (result.done) break;
        yield result.value;
      }
    }
  }
}
```

The session starts once and stays open. New messages are pushed into the queue, and the SDK processes them as they arrive:

```typescript
startSession(): void {
  this.messageQueue = new MessageQueue();

  this.currentQuery = query({
    prompt: this.messageQueue[Symbol.asyncIterator](),
    options: {
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      includePartialMessages: true,  // Enable streaming deltas
      permissionMode: 'default',
      cwd: this.cwd,
    },
  });
}
```

The `includePartialMessages: true` option is critical. Without it, you only get complete messages after the model finishes generating. With it, you get `stream_event` messages containing text and thinking deltas as they're produced.

### Streaming Message Transformation

The background consumer in `SessionManager` transforms raw SDK messages into a simplified protocol for the frontend:

```typescript
for await (const rawMessage of agent.receiveResponse()) {
  const sdkMessage = rawMessage as SDKMessage;

  // Real-time text streaming (character-by-character)
  if (sdkMessage.type === 'stream_event') {
    if (event.delta?.type === 'text_delta') {
      this._onAgentMessage.fire({
        sessionId,
        message: { type: 'text', content: event.delta.text },
      });
    }
    if (event.delta?.type === 'thinking_delta') {
      this._onAgentMessage.fire({
        sessionId,
        message: { type: 'thinking', content: event.delta.thinking },
      });
    }
  }

  // Tool use blocks from complete assistant messages
  if (sdkMessage.type === 'assistant') {
    for (const block of sdkMessage.message.content) {
      if (block.type === 'tool_use') {
        this._onAgentMessage.fire({
          sessionId,
          message: {
            type: 'tool_use',
            content: `Using tool: ${block.name}`,
            metadata: { toolName: block.name, toolId: block.id, toolInput: block.input },
          },
        });
      }
    }
  }

  // Turn completion with usage stats
  if (sdkMessage.type === 'result') {
    this._onAgentMessage.fire({
      sessionId,
      message: {
        type: 'result',
        content: 'Turn complete',
        usage: { inputTokens: ..., outputTokens: ... },
        totalCostUsd: resultMsg.total_cost_usd,
      },
    });
  }
}
```

Each `AgentMessage` has a simple type discriminator: `text`, `thinking`, `tool_use`, `result`, or `error`. Text and thinking messages carry **deltas** (incremental content), not the full accumulated text. The frontend accumulates these.

---

## Layer 3: The Rust Bridge - Process Management Done Right

The Rust layer is intentionally thin. It has exactly one job: manage the Node.js process lifecycle and shuttle JSON between it and the frontend.

### Spawning the Sidecar

```rust
// agent/bridge.rs
pub fn spawn(&mut self, node_script_path: &str) -> Result<()> {
    let mut child = Command::new("node")
        .arg(node_script_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())  // Debug logs go to parent's stderr
        .spawn()
        .map_err(|e| BridgeError::SpawnError(e.to_string()))?;

    let stdin = child.stdin.take().ok_or(/* ... */)?;
    let stdout = child.stdout.take().ok_or(/* ... */)?;

    // Bounded channel prevents memory issues from event backpressure
    let (tx, rx) = bounded(1000);
    self.response_rx = Some(rx);

    // Dedicated reader thread for stdout
    let event_callback = self.event_callback.clone();
    thread::spawn(move || {
        Self::reader_thread(stdout, &tx, event_callback.as_ref());
    });

    self.stdin = Some(Arc::new(Mutex::new(stdin)));

    // Block until sidecar sends { type: "ready" }
    self.wait_for_ready()?;
    Ok(())
}
```

Key design decisions:

1. **Bounded channel (capacity 1000)** - If the frontend can't keep up with events, the channel applies backpressure rather than consuming unlimited memory.

2. **Dedicated reader thread** - A separate thread continuously reads from stdout. This prevents deadlocks where Rust is trying to write to stdin while stdout's buffer fills up.

3. **Ready handshake** - The bridge blocks on startup until the sidecar sends a `ready` event. This prevents requests from being sent before the SDK is initialized.

### The Reader Thread - Dual Dispatch

The reader thread has an important dual-dispatch pattern:

```rust
fn reader_thread(stdout: ChildStdout, tx: &Sender<BridgeResponse>, event_callback: Option<&EventCallback>) {
    let reader = BufReader::new(stdout);
    for line in reader.lines() {
        match serde_json::from_str::<BridgeResponse>(&line?) {
            Ok(response) => {
                // 1. Fire event callback immediately (for streaming to frontend)
                if let Some(event) = response.as_event() {
                    if let Some(callback) = event_callback {
                        callback(event.clone());
                    }
                }

                // 2. Also send through channel (for request-response matching)
                tx.send(response)?;
            }
            Err(e) => tracing::error!("Failed to parse: {e}"),
        }
    }
}
```

Every message from stdout goes to **both** the event callback and the response channel. Events are fired immediately to the frontend via the callback. Command responses are picked up by the `send_request` method which loops on the channel, skipping events until it finds a command response:

```rust
pub fn send_request(&self, request: &BridgeRequest) -> Result<CommandResponse> {
    // Write request to stdin
    {
        let mut stdin_guard = self.stdin.lock();
        let json = serde_json::to_string(request)?;
        writeln!(stdin_guard, "{json}")?;
        stdin_guard.flush()?;
    }

    // Wait for matching command response (skip events)
    let timeout = Duration::from_secs(300);
    loop {
        match self.response_rx.recv_timeout(timeout) {
            Ok(response) => {
                if let Some(cmd) = response.as_command() {
                    return Ok(cmd.clone());
                }
                // Event - already handled by callback, skip
            }
            Err(RecvTimeoutError::Timeout) => return Err(BridgeError::Timeout),
            Err(RecvTimeoutError::Disconnected) => return Err(BridgeError::ReceiveError(..)),
        }
    }
}
```

### Wiring Events to Tauri Emit

The event callback is set up once during app initialization and bridges directly to Tauri's event system:

```rust
// agent_commands.rs
pub fn setup_event_callbacks(app: &AppHandle, session_manager: &Arc<SessionManager>) {
    let app_handle = app.clone();
    session_manager.set_event_callback(Arc::new(move |event: BridgeEvent| {
        match event {
            BridgeEvent::AgentMessage { session_id, message } => {
                app_handle.emit("agent:message", json!({
                    "sessionId": session_id,
                    "message": message,
                }));
            }
            BridgeEvent::PermissionRequest { request } => {
                app_handle.emit("agent:permission_request", request);
            }
            BridgeEvent::Ready => {
                app_handle.emit("agent:ready", ());
            }
            // ... more event types
        }
    }));
}
```

Each event type gets its own Tauri channel (`agent:message`, `agent:permission_request`, etc.). This keeps the frontend listeners focused and prevents a single event handler from becoming a giant switch statement.

---

## Layer 4: The React Frontend - Accumulating Streams

### The Singleton Listener Pattern

The frontend registers a single event listener on mount that never re-subscribes, using a ref-based proxy to always call the latest store actions:

```typescript
// hooks/useAgentStream.ts
export function useAgentStream(): void {
  const handlersRef = useRef<AgentEventHandlers>({});

  // Update ref every render (cheap, no effect dependency)
  handlersRef.current = {
    onMessage: useAgentStore((s) => s.handleAgentMessage),
    onPermissionRequest: useAgentStore((s) => s.handlePermissionRequest),
  };

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    // Proxy delegates through ref - always calls latest handler
    const proxy: AgentEventHandlers = {
      onMessage: (sid, msg) => handlersRef.current.onMessage?.(sid, msg),
      onPermissionRequest: (req) => handlersRef.current.onPermissionRequest?.(req),
    };

    listenToAgentEvents(proxy).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, []); // Empty deps - register once, never re-subscribe
}
```

This avoids a common bug in Tauri apps where store action references change on every render, causing the event listener to be torn down and recreated thousands of times.

### Delta Accumulation in Zustand

The store accumulates streaming deltas into ordered content blocks:

```typescript
// stores/agentStore.ts
handleAgentMessage: (sessionId: string, message: BridgeAgentMessage) => {
  set((state) => {
    const streamState = getOrCreateStreamState(state.sessionStreaming, sessionId);

    switch (message.type) {
      case 'text': {
        // Append delta to accumulated content
        streamState.streamingContent += message.content;

        // Update the last text block, or create one
        const msg = getCurrentAssistantMessage(state, sessionId);
        const lastBlock = msg.blocks[msg.blocks.length - 1];
        if (lastBlock?.type === 'text') {
          lastBlock.text = streamState.streamingContent;
        } else {
          msg.blocks.push({ type: 'text', text: streamState.streamingContent });
        }
        break;
      }

      case 'thinking': {
        streamState.streamingThinking += message.content;
        // Thinking block always at front
        const firstBlock = msg.blocks[0];
        if (firstBlock?.type === 'thinking') {
          firstBlock.text = streamState.streamingThinking;
        } else {
          msg.blocks.unshift({ type: 'thinking', text: streamState.streamingThinking });
        }
        break;
      }

      case 'tool_use': {
        msg.blocks.push({
          type: 'tool_use',
          toolCall: {
            id: message.metadata.toolId,
            name: message.metadata.toolName,
            input: message.metadata.toolInput,
            status: message.metadata.status,
          },
        });
        break;
      }

      case 'result': {
        streamState.isStreaming = false;
        msg.isStreaming = false;
        msg.usage = message.usage;
        msg.costUsd = message.totalCostUsd;
        break;
      }
    }
  });
}
```

The `blocks` array maintains **document order** - thinking first, then interleaved text and tool calls exactly as they appear in the conversation. This is what enables rendering like:

```
[Thinking box - collapsed]
Here's what I'll do...
[Tool: Bash - running `npm test`]
The tests pass. Let me also check...
[Tool: Read - reading src/index.ts]
Everything looks good.
```

### The Message Adapter

A final transformation layer converts store messages into render-ready blocks:

```typescript
// messageAdapter.ts
type RenderBlock =
  | { type: 'narrative'; content: string }
  | { type: 'thinking'; content: string; durationMs?: number }
  | { type: 'toolCall'; id: string; toolName: string; status: 'running' | 'success' | 'error' }
  | { type: 'approval'; requestId: string; toolName: string; toolInput: unknown }
```

Tool calls with `status: 'awaiting-permission'` become `approval` blocks that render inline permission dialogs. Everything else renders as its respective widget.

---

## The Permission Flow - Interactive Tool Approval

When Claude wants to run a tool (write a file, execute a command), the entire pipeline pauses for user approval:

```
1. SDK calls canUseTool(toolName, toolInput)
2. Node.js creates a Promise and fires permission_request event
3. Event flows: stdout -> reader thread -> event callback -> Tauri emit
4. React renders inline approval dialog
5. User clicks Approve/Deny
6. Frontend calls invoke('agent_respond_permission', { requestId, decision })
7. Rust sends PermissionResponse to Node.js stdin
8. Node.js resolves the Promise
9. SDK continues or aborts tool execution
```

The key: the Promise in step 2 has **no timeout**. The user can take as long as they want. The SDK is configured with `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT=86400000` (24 hours) to prevent the stream from closing while waiting.

---

## How to Implement This Yourself

### Prerequisites
- A Claude Pro/Team subscription
- Claude Code CLI installed and authenticated (`claude login`)
- Node.js 18+
- A Tauri 2 project (or any desktop framework that can spawn processes)

### Step 1: Set Up the Agent Bridge

Create a Node.js package with the Claude Agent SDK:

```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.1.76"
  }
}
```

### Step 2: Read Credentials

Use the Keychain reading approach shown above. The critical insight: when an OAuth token is detected, **clear `ANTHROPIC_API_KEY`** from the environment. This forces the SDK to use the CLI auth path, which consumes your subscription quota instead of API credits.

### Step 3: Implement the stdio Protocol

Your host application (Rust, Go, Python, whatever) needs to:
1. Spawn `node your-bridge.js` with piped stdin/stdout
2. Read newline-delimited JSON from stdout in a separate thread
3. Write newline-delimited JSON to stdin for requests
4. Distinguish events from command responses by the `type` field

### Step 4: Handle Streaming

The SDK emits `stream_event` messages with `text_delta` and `thinking_delta` types. These are small chunks (often single words or characters). Your frontend should accumulate them efficiently.

### Step 5: Implement Permissions

The `canUseTool` callback in the SDK is your permission gate. When called, emit a permission request to your frontend, wait for the user's response, and return the decision. This is the one synchronous blocking point in the pipeline.

---

## Key Takeaways

1. **You don't need API keys.** If you have a Claude subscription, the OAuth token in your Keychain is all you need. Clear the API key env vars and the SDK falls through to CLI auth.

2. **The sidecar pattern works.** Don't fight language ecosystems. If the SDK is Node.js-only, spawn a Node.js process. The overhead of JSON serialization over stdin/stdout is negligible compared to network latency to Claude's servers.

3. **Newline-delimited JSON is underrated.** It's trivially parseable, debuggable (just pipe to `jq`), and handles the mixed command-response + event stream naturally.

4. **Bounded channels prevent disasters.** If your frontend can't keep up with streaming events, a bounded channel applies backpressure gracefully instead of consuming unlimited memory.

5. **Streaming deltas need accumulation state.** Don't try to render individual deltas. Accumulate them in a store and re-render the accumulated content. Immer + Zustand makes this efficient.

6. **Permission handling is the hardest part.** The async permission flow crosses all three layers (SDK callback -> IPC event -> UI dialog -> IPC response -> callback resolution). Get this wrong and you'll have deadlocks or timeouts.

---

## The Stack

| Layer | Technology | Role |
|-------|-----------|------|
| Frontend | React 19 + Zustand + Immer | UI rendering, state accumulation |
| Desktop Shell | Tauri 2 | Window management, IPC bridge |
| Backend | Rust | Process management, event routing |
| Sidecar | Node.js + Claude Agent SDK | AI session management, tool execution |
| Auth | macOS Keychain (OAuth) | Credential storage and reuse |

---

*Solo IDE is open source. The agent bridge pattern described here can be adapted for any desktop framework - Electron, Qt, GTK, or even a plain CLI. The only requirement is the ability to spawn a child process and communicate over stdin/stdout.*
