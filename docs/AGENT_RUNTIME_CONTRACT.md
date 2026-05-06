# Agent Runtime Contract

Solo has one active agent harness:

```
React desktop UI -> Tauri Rust bridge -> Node agent-bridge -> Claude Agent SDK
```

The old Hono `server/` backend is not part of the runtime. Agent mode is SDK-first and Anthropic-only for v1. OpenAI and Gemini sessions are chat-only.

## Provider Capabilities

The frontend and bridge exchange a provider capability object:

```ts
{
  chat: boolean;
  agent: boolean;
  tools: boolean;
  mcp: boolean;
  resume: boolean;
}
```

Current behavior:

| Provider | Chat | Agent | Tools | MCP | Resume |
|----------|------|-------|-------|-----|--------|
| Anthropic | Yes | Yes | Yes | Yes | Yes |
| OpenAI | Yes | No | No | No | No |
| Gemini | Yes | No | No | No | No |

Creating `sessionMode: "agent"` with a provider that lacks `agent: true` must fail before any model request is started. Task execution has the same restriction.

## Session Configuration

`SessionConfig` is the single wire shape shared across frontend, Rust, and Node. SDK-specific fields stay JSON-compatible so Rust does not need to mirror every SDK type.

Important fields:

- `provider`: provider id, defaulting to `anthropic` for backwards compatibility.
- `providerCapabilities`: capability object used by UI and bridge guards.
- `sessionMode`: `agent` or `chat`.
- `allowedTools`: true SDK tool allow-list. This is not used for skills.
- `selectedSkills`: session-level skill names visible through the `solo_skills` MCP server.
- `mcpServers`: JSON-compatible MCP server map passed to the SDK at session start.
- `outputFormat`: JSON-compatible SDK output format.
- `agents`: JSON-compatible SDK custom agent config.
- `toolPolicy`: deny/allow/ask rules, Bash allow prefixes, bypass flag, and worktree-session flag.
- `permissionMode`: effective starting mode, such as `default`, `plan`, `accept`, or `debug`.
- `resumeSessionId`: SDK session id to resume.

MCP/plugin configuration is fixed at session creation. Plugin or MCP changes apply to new sessions or an explicit restart.

## Canonical Events

The bridge emits canonical agent messages:

- `session_init`: SDK session id and resume/fork state.
- `turn_start`: one event per user turn, emitted by Node before the message is queued.
- `text`: assistant text.
- `thinking`: model thinking content when enabled.
- `tool_use`: tool call start or permission-pending state.
- `tool_result`: tool completion or failure.
- `result`: turn completion with usage, cost, and optional structured output.
- `error`: runtime/session error.

`BridgeAgentMessage` includes `eventId`, `turnNumber`, optional `sdkSessionId`, optional `structuredOutput`, and optional `resultSubtype`. `result.content` is the human-readable final status or summary.

## Permissions

Permission precedence is:

1. Explicit deny rule.
2. Built-in dangerous Bash deny rule.
3. Explicit allow rule.
4. Explicit ask rule.
5. Destructive tool prompt.
6. Active mode rule.
7. User prompt fallback.

Read-only tools are auto-approved: `Read`, `Glob`, `Grep`, `WebSearch`, `WebFetch`, MCP resource reads, vault search, and `solo_skills` reads. `Task` is not read-only and requires the normal permission path.

Accept mode auto-approves file edits only: `Write`, `Edit`, and `NotebookEdit`. Bash still requires an allow rule or explicit approval. Bypass mode is only valid for task-owned worktree sessions and still honors deny-lists.

## Skills And MCP

Per-message skill chips still inject prompt content for that one message. Session-level skills use `selectedSkills`.

The bridge always provides an in-process `solo_skills` MCP server with:

- `skill_list`: list skills visible to the session.
- `skill_read`: read one enabled skill by name.

This lets the model discover and read skills without dumping all skill content into every prompt.

## Persistence And Resume

The bridge writes a JSONL ledger under Solo app data with canonical events, SDK session id, cwd, provider, model/config metadata, usage, and final results.

Resume uses the SDK resume id as the model-context source of truth. UI message history is display persistence only. If SDK resume fails, the UI session is stale and must not silently continue; the user must start a new continuation or fork.
