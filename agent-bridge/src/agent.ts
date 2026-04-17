/**
 * Claude Agent SDK integration for Orbit Editor (TypeScript).
 */

import { query } from '@anthropic-ai/claude-agent-sdk';

import * as fs from 'node:fs';

import { ClaudeCredentials } from './credentials.js';
import { createLogger } from './logger.js';
import { loadMergedSettings } from './permission-pipeline.js';
import { PermissionManager } from './permissions.js';
import { generatePlanName, getPlanFilePath, ensurePlanDirectory } from './plan-names.js';
import { getAllowedToolsForMode } from './session-mode.js';
// Option D UX: skills are injected per-message as content blocks from the
// desktop frontend (see agentStore.toContentBlocks). The session-level
// `loadSkills` import is intentionally removed so unchipped skills don't
// leak into the system prompt. The helper file still exists for the
// Skills settings UI and future callers.
import { buildIdentityAppend } from './identity-grounding.js';
import { buildContentBlocks } from './utils/content.js';
import { formatToolResult } from './utils/formatter.js';

import type { AttachmentContentBlock } from './messages.js';
import type { PermissionRequestCallback, SnapshotCallback } from './permissions.js';
import type { OrbitSessionMode } from './session-mode.js';
import type {
  AgentDefinition,
  HookJSONOutput,
  McpServerConfig,
  NotificationHookInput,
  Options,
  OutputFormat,
  PermissionMode,
  PostToolUseFailureHookInput,
  PostToolUseHookInput,
  PreCompactHookInput,
  PreToolUseHookInput,
  Query,
  SDKMessage,
  SDKUserMessage,
  SessionEndHookInput,
  SessionStartHookInput,
  SubagentStartHookInput,
  SubagentStopHookInput,
} from '@anthropic-ai/claude-agent-sdk';

const logger = createLogger('OrbitAgent');

/**
 * Tool result block type for type guard
 */
interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

/**
 * Tool use block type for type guard
 */
interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Type guard for tool_result blocks
 */
function isToolResultBlock(block: unknown): block is ToolResultBlock {
  if (typeof block !== 'object' || block === null) {
    return false;
  }
  const obj = block as Record<string, unknown>;
  return (
    obj.type === 'tool_result' &&
    typeof obj.tool_use_id === 'string' &&
    typeof obj.content === 'string'
  );
}

/**
 * Type guard for tool_use blocks
 */
function isToolUseBlock(block: unknown): block is ToolUseBlock {
  if (typeof block !== 'object' || block === null) {
    return false;
  }
  const obj = block as Record<string, unknown>;
  return (
    obj.type === 'tool_use' &&
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.input === 'object' &&
    obj.input !== null
  );
}

/**
 * Helper to safely get message content as array
 */
function getMessageContentArray(message: SDKMessage): unknown[] | null {
  if (message.type !== 'assistant' && message.type !== 'user') {
    return null;
  }
  const msg = message as { message?: { content?: unknown } };
  const content = msg.message?.content;
  if (!Array.isArray(content)) {
    return null;
  }
  // Cast to unknown[] to satisfy type checker
  return content as unknown[];
}

export interface OrbitAgentConfig {
  permissionRequestCallback?: PermissionRequestCallback;
  snapshotCallback?: SnapshotCallback;
  resumeSessionId?: string;
  forkSession?: boolean;
  model?: string;
  /** Fallback model to use if primary model fails */
  fallbackModel?: string;
  thinkingEnabled?: boolean;
  /** Token budget for extended thinking (default: 10000) */
  maxThinkingTokens?: number;
  /** Output-token cap per response — set via CLAUDE_CODE_MAX_OUTPUT_TOKENS env var */
  maxTokens?: number;
  planEnabled?: boolean;
  acceptEnabled?: boolean;
  debugEnabled?: boolean;
  critiqueEnabled?: boolean;
  cwd?: string;
  sessionMode?: OrbitSessionMode;
  /** MCP servers to register with the agent (e.g., DevTools, custom tools) */
  mcpServers?: Record<string, McpServerConfig>;
  /**
   * Structured output format - when set, the agent will return validated JSON
   * matching the provided JSON Schema in the result message's structured_output field.
   */
  outputFormat?: OutputFormat;
  /**
   * Custom subagents that can be invoked via the Task tool.
   * Keys are agent names, values are agent definitions with description, prompt, and optional tools/model.
   */
  agents?: Record<string, AgentDefinition>;
}

/**
 * Message queue for streaming input mode.
 * Implements async iterator to yield messages as they are added.
 */
class MessageQueue {
  private queue: SDKUserMessage[] = [];
  private resolvers: ((value: IteratorResult<SDKUserMessage>) => void)[] = [];
  private stopped = false;

  /**
   * Add a message to the queue.
   * If a consumer is waiting, resolve immediately.
   * Otherwise, add to queue for later consumption.
   */
  add(message: string, attachments?: AttachmentContentBlock[]): void {
    if (this.stopped) {
      throw new Error('Message queue has been stopped');
    }

    // Build content blocks using the utility
    const content = buildContentBlocks(message, attachments);

    const sdkMessage: SDKUserMessage = {
      type: 'user',
      message: {
        role: 'user',
        content: content, // Can be string or array of content blocks
      },
      parent_tool_use_id: null,
      session_id: '', // SDK will assign the real session_id
    };

    // If we have a waiting consumer, resolve immediately
    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift();
      if (resolve) {
        resolve({ value: sdkMessage, done: false });
      }
    } else {
      // Otherwise queue for later
      this.queue.push(sdkMessage);
    }
  }

  /**
   * Stop the queue (marks as complete).
   * Resolves any waiting consumers with done: true.
   */
  stop(): void {
    this.stopped = true;
    // Resolve all waiting consumers
    for (const resolve of this.resolvers) {
      resolve({ value: undefined, done: true });
    }
    this.resolvers = [];
  }

  /**
   * Async iterator implementation.
   * Yields messages from queue or waits for new messages.
   */
  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage, void, unknown> {
    while (!this.stopped) {
      // If queue has messages, yield them
      if (this.queue.length > 0) {
        const message = this.queue.shift();
        if (message) {
          yield message;
        }
      } else {
        // Wait for next message
        const result = await new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
          this.resolvers.push(resolve);
        });

        if (result.done) {
          break;
        }

        yield result.value;
      }
    }
  }
}

export class OrbitAgent {
  private currentQuery: Query | null = null;
  private permissionManager: PermissionManager;
  private cwd: string;
  private _thinkingMode: boolean;
  private _thinkingBudget: number; // 0=off, 4096=think, 10240=hard, 32768=ultra
  private _planMode: boolean;
  private _planFilePath: string | null = null;
  private _acceptMode: boolean;
  private _debugMode: boolean = false;
  /** Captured goal text for Debug mode — set on first user prompt when debug is on. */
  private _debugGoal: string | null = null;
  /** Counts assistant turns since the last Debug-mode review question. */
  private _debugTurnsSinceReview = 0;
  /** Turns-between-reviews cadence — overridden from merged settings at startup. */
  private _debugReviewInterval = 3;
  private _critiqueMode: boolean;
  private model?: string;
  private _fallbackModel?: string;
  private _maxTokens?: number;
  private _sessionMode: OrbitSessionMode;

  // Session resume/fork fields
  private _resumeSessionId?: string;
  private _forkSession: boolean;
  private _currentSessionId?: string;

  // Streaming input mode fields
  private messageQueue: MessageQueue | null = null;
  private sessionActive = false;

  // MCP servers (DevTools, custom tools, etc.)
  private _mcpServers: Record<string, McpServerConfig>;

  // Structured output format (JSON Schema)
  private _outputFormat?: OutputFormat;

  // Custom subagents for Task tool
  private _agents?: Record<string, AgentDefinition>;

  constructor(config: OrbitAgentConfig = {}) {
    this.permissionManager = new PermissionManager(
      config.permissionRequestCallback,
      config.snapshotCallback,
      () => this._acceptMode, // Accept mode (dynamic)
      () => this._planMode,   // Plan mode (dynamic)
      () => this._planFilePath, // Plan file path for Plan-mode write special case
      () => this.cwd, // Workspace for loading .solo/settings.json
      () => this._debugMode // Debug mode (dynamic)
    );
    this.cwd = config.cwd ?? process.cwd();
    this._thinkingMode = config.thinkingEnabled ?? false;
    this._thinkingBudget = config.maxThinkingTokens ?? 0; // 0=off, 4096=think, 10240=hard, 32768=ultra
    this._planMode = config.planEnabled ?? false;
    // Generate plan file path if plan mode is already enabled (e.g., from stored preferences)
    if (this._planMode) {
      const planName = generatePlanName();
      this._planFilePath = getPlanFilePath(planName, this.cwd);
      ensurePlanDirectory(this.cwd);
      logger.info({ planName, planFilePath: this._planFilePath }, 'Plan file path generated during construction');
    }
    this._acceptMode = config.acceptEnabled ?? false;
    this._debugMode = config.debugEnabled ?? false;
    this._critiqueMode = config.critiqueEnabled ?? false;
    this._sessionMode = config.sessionMode ?? 'agent';
    this._resumeSessionId = config.resumeSessionId;
    this._forkSession = config.forkSession ?? false;
    if (config.model !== undefined) {
      this.model = config.model;
    }
    if (config.fallbackModel !== undefined) {
      this._fallbackModel = config.fallbackModel;
    }
    if (config.maxTokens !== undefined) {
      this._maxTokens = config.maxTokens;
    }
    this._mcpServers = config.mcpServers ?? {};
    this._outputFormat = config.outputFormat;
    this._agents = config.agents;

    // Load the Debug-mode review cadence from `.solo/settings.json` (if any).
    // Falls back to 3 when the workspace doesn't define one.
    try {
      const settings = loadMergedSettings(this.cwd);
      const interval = settings.modes.debug.reviewInterval;
      if (typeof interval === 'number' && interval > 0) {
        this._debugReviewInterval = interval;
      }
    } catch {
      // Settings are optional — keep the default.
    }
    logger.info(
      {
        sessionMode: this._sessionMode,
        mcpServerCount: Object.keys(this._mcpServers).length,
        hasOutputFormat: !!this._outputFormat,
        agentCount: this._agents ? Object.keys(this._agents).length : 0,
      },
      'OrbitAgent created with session mode'
    );
  }

  /**
   * Register an MCP server dynamically (before session start)
   */
  registerMcpServer(name: string, server: McpServerConfig): void {
    if (this.sessionActive) {
      logger.warn('Cannot register MCP server after session has started');
      return;
    }
    this._mcpServers[name] = server;
    logger.info({ name }, 'MCP server registered');
  }

  /**
   * Unregister an MCP server
   */
  unregisterMcpServer(name: string): void {
    const { [name]: _removed, ...rest } = this._mcpServers;
    void _removed; // Intentionally unused, destructuring to remove from object
    this._mcpServers = rest;
    logger.info({ name }, 'MCP server unregistered');
  }

  /**
   * Set or remove the browser MCP server.
   * Call with server when browser panel is opened and session is active.
   * Call with null when browser panel is closed.
   */
  setBrowserMcpServer(server: McpServerConfig | null): void {
    if (server) {
      this.registerMcpServer('browser', server);
    } else {
      this.unregisterMcpServer('browser');
    }
  }

  /**
   * Check if browser MCP server is registered
   */
  hasBrowserMcpServer(): boolean {
    return Object.hasOwn(this._mcpServers, 'browser');
  }

  /**
   * Get the permission manager instance
   */
  getPermissionManager(): PermissionManager {
    return this.permissionManager;
  }

  /**
   * Preview what the permission pipeline would decide for a tool call, without
   * invoking any side effects. Used by the session-manager to pick the right
   * initial `status` on streamed `tool_use` events so auto-approved tools
   * never flash an approval card.
   */
  previewPermission(
    toolName: string,
    toolInput: Record<string, unknown>
  ): 'allow' | 'ask' | 'deny' {
    return this.permissionManager.previewDecision(toolName, toolInput);
  }

  private _createOptions(): Options {
    /**
     * Create Claude agent options with full Claude Code capabilities.
     */
    const options: Options = {
      // Use Claude Code's official system prompt with browser automation docs
      systemPrompt: {
        type: 'preset' as const,
        preset: 'claude_code' as const,
        append: `
${buildIdentityAppend(this.model)}

## Browser Automation

You have access to browser automation tools via MCP. Use mcp__browser__open_browser to start a browser session.

### Panel Control
- **mcp__browser__open_browser**: Open the browser panel and navigate to URL. Use this first if browser is not open.
- **mcp__browser__close_browser**: Close the browser panel when done with automation.

### Navigation
- **mcp__browser__navigate**: Go to URL (returns accessibility snapshot with element refs)
- **mcp__browser__go_back / mcp__browser__go_forward / mcp__browser__reload**: History navigation
- **mcp__browser__url**: Get current URL

### Interaction
- **mcp__browser__click**: Click by CSS selector
- **mcp__browser__click_ref**: Click by accessibility ref (preferred - more reliable)
- **mcp__browser__type**: Type text character by character
- **mcp__browser__fill**: Fill form field (clears first, more reliable for inputs)
- **mcp__browser__select**: Select dropdown option
- **mcp__browser__hover**: Hover over element
- **mcp__browser__press_key**: Press keyboard key (Enter, Tab, Escape, ArrowDown, etc.)
- **mcp__browser__scroll**: Scroll page or element

### Observation
- **mcp__browser__snapshot**: Get accessibility tree showing all interactive elements with refs
- **mcp__browser__screenshot**: Capture visual screenshot
- **mcp__browser__wait**: Wait for element to appear

### JavaScript
- **mcp__browser__evaluate**: Execute JavaScript in page context

### Console/Network
- **mcp__browser__console_logs**: Get console messages (errors, warnings, logs)
- **mcp__browser__network_requests**: Get network requests (useful for debugging API calls)

### Recommended Workflow
1. Use mcp__browser__open_browser to start a browser session (or mcp__browser__navigate if already open)
2. Read the snapshot to find elements and their refs (e.g., ref="ref-5")
3. Use mcp__browser__click_ref with refs for reliable clicking (not CSS selectors)
4. After interactions, call mcp__browser__snapshot to see updated page state
5. Use mcp__browser__console_logs to check for JavaScript errors
6. Use mcp__browser__close_browser when done

### Tips
- **Use open_browser first** - it opens the panel and navigates in one step
- **Prefer refs over CSS selectors** - accessibility refs from snapshots are more reliable
- **Always check snapshot after navigation** to understand page structure
- **For forms**: use mcp__browser__fill for inputs, mcp__browser__select for dropdowns
- **Check console for errors** after page loads or after interactions fail

## Chrome DevTools (Advanced)

When browser is open, you also have access to Chrome DevTools Protocol tools via mcp__orbit-devtools__*:

### Console
- **devtools_console_get**: Get console logs with filtering by type (log/warn/error/info/debug)
- **devtools_console_clear**: Clear console messages
- **devtools_console_eval**: Execute JavaScript in console context

### Network (Detailed)
- **devtools_network_get**: Get network requests with filtering (url pattern, method, status)
- **devtools_network_detail**: Get full request/response details including headers and body
- **devtools_network_clear**: Clear network logs

### DOM Inspection
- **devtools_dom_query**: Query DOM with CSS selectors, get element structure
- **devtools_dom_html**: Get outer HTML of elements
- **devtools_dom_styles**: Get computed CSS styles for elements
- **devtools_dom_attributes**: Get all attributes of an element

### Performance
- **devtools_perf_metrics**: Get performance metrics (memory, DOM stats, rendering times)
- **devtools_perf_trace_start**: Start recording performance trace
- **devtools_perf_trace_stop**: Stop trace and get timeline events

### Storage
- **devtools_storage_local / devtools_storage_session**: Get localStorage/sessionStorage
- **devtools_storage_cookies**: Get cookies (optionally filter by domain)
- **devtools_storage_set_local / devtools_storage_set_session**: Set storage items
- **devtools_storage_set_cookie**: Set a cookie with full options
- **devtools_storage_clear**: Clear storage (local/session/cookies/all)

### General
- **devtools_eval**: Execute JavaScript with full page access, can await promises
- **devtools_page_info**: Get current page title and URL

### When to Use DevTools vs Browser Tools
- **Browser tools (mcp__browser__)**: Page interaction, navigation, clicking, typing
- **DevTools tools (mcp__orbit-devtools__)**: Deep inspection, debugging, storage, performance analysis
`,
      },
      // Working directory
      cwd: this.cwd,
      // Load CLAUDE.md from project directory for project-specific instructions
      settingSources: ['project'],
    };

    // Only add thinking tokens if thinking mode is enabled and budget > 0
    if (this._thinkingMode && this._thinkingBudget > 0) {
      options.maxThinkingTokens = this._thinkingBudget;
      // Map budget to mode name for logging
      const modeName =
        this._thinkingBudget <= 4096 ? 'think' : this._thinkingBudget <= 10240 ? 'hard' : 'ultra';
      logger.info(
        { thinkingMode: modeName, thinkingBudget: this._thinkingBudget },
        'Extended thinking ENABLED'
      );
    } else {
      logger.info({ thinkingMode: 'off' }, 'Extended thinking DISABLED');
    }

    // Permission handling based on session mode
    if (this._sessionMode === 'chat') {
      // Chat mode: Use allowedTools array (no permission prompts)
      const chatTools = getAllowedToolsForMode('chat');
      options.allowedTools = chatTools;
      logger.info({ mode: 'chat', tools: chatTools }, 'Chat mode - read-only tools auto-approved');
    } else {
      // Agent mode: Use proper SDK permission flow
      // SDK Flow: PreToolUse Hook → Deny Rules → Allow Rules → Ask Rules → Permission Mode → canUseTool
      const permissionCallback = this.permissionManager.createCallback();
      logger.debug('Using SDK permission flow with canUseTool callback');

      // canUseTool callback fires when SDK would show a permission prompt
      // (i.e., hooks return 'continue' and rules don't cover it)
      options.canUseTool = async (toolName, toolInput, canUseToolOptions) => {
        logger.debug({ toolName }, 'canUseTool callback invoked');
        try {
          const result = await permissionCallback(toolName, toolInput, {
            signal: canUseToolOptions.signal,
            suggestions: canUseToolOptions.suggestions ?? [],
          });
          return result;
        } catch (error) {
          logger.error({ toolName, error }, 'canUseTool callback error');
          return {
            behavior: 'deny' as const,
            message: 'Permission request failed',
          };
        }
      };

      // Set up hooks for the SDK
      // PreToolUse: Only auto-approve specific tools, return {} to continue SDK flow for others
      // PostToolUse, PostToolUseFailure, Notification, etc.: For tracking and events
      // Track subagent start times for duration
      const subagentStartTimes = new Map<string, number>();

      // Safe read-only tools that are always auto-approved via PreToolUse hook.
      // These never reach canUseTool, so no permission prompt is shown.
      const SAFE_TOOLS = new Set([
        'Read',
        'Glob',
        'Grep',
        'WebSearch',
        'WebFetch',
        'Task',
        'TodoWrite',
        'ListMcpResourcesTool',
        'ReadMcpResourceTool',
      ]);

      options.hooks = {
        // PreToolUse hook - auto-approve safe tools, let SDK handle others
        PreToolUse: [
          {
            // No matcher means match ALL tools
            timeout: 86400, // 24 hours for indefinite waiting
            hooks: [
              (input: unknown): Promise<HookJSONOutput> => {
                const preToolInput = input as PreToolUseHookInput;
                const toolName = preToolInput.tool_name;
                const toolInput = preToolInput.tool_input as Record<string, unknown>;

                logger.info(
                  {
                    toolName,
                    inputKeys: Object.keys(toolInput),
                  },
                  'Hook: PreToolUse — tool requested'
                );

                // Auto-approve safe read-only tools — no file modifications, no side effects
                if (SAFE_TOOLS.has(toolName)) {
                  logger.debug({ toolName }, 'Hook: PreToolUse — auto-approved (safe tool)');
                  return Promise.resolve({
                    hookSpecificOutput: {
                      hookEventName: 'PreToolUse' as const,
                      permissionDecision: 'allow' as const,
                      updatedInput: toolInput,
                    },
                  });
                }

                // Return empty object to continue SDK permission flow
                // SDK will check Deny Rules → Allow Rules → Ask Rules → Permission Mode → canUseTool
                logger.debug({ toolName }, 'Hook: PreToolUse — delegating to SDK permission flow');
                return Promise.resolve({});
              },
            ],
          },
        ],

        // PostToolUse hook - log tool response + duration
        PostToolUse: [
          {
            timeout: 30,
            hooks: [
              (input: unknown, toolUseId?: string): Promise<HookJSONOutput> => {
                const postInput = input as PostToolUseHookInput;
                const response = postInput.tool_response;
                const responseStr = typeof response === 'string' ? response : JSON.stringify(response);
                logger.info(
                  {
                    toolName: postInput.tool_name,
                    toolUseId,
                    responsePreview: responseStr?.slice(0, 500),
                    responseLength: responseStr?.length ?? 0,
                  },
                  'Hook: PostToolUse — tool completed'
                );
                return Promise.resolve({});
              },
            ],
          },
        ],

        // PostToolUseFailure hook - log full error + context
        PostToolUseFailure: [
          {
            timeout: 30,
            hooks: [
              (input: unknown, toolUseId?: string): Promise<HookJSONOutput> => {
                const failureInput = input as PostToolUseFailureHookInput;
                logger.warn(
                  {
                    toolName: failureInput.tool_name,
                    toolUseId,
                    error: failureInput.error,
                    isInterrupt: failureInput.is_interrupt,
                    toolInput: failureInput.tool_input
                      ? JSON.stringify(failureInput.tool_input).slice(0, 300)
                      : undefined,
                  },
                  'Hook: PostToolUseFailure — tool failed'
                );
                return Promise.resolve({});
              },
            ],
          },
        ],

        // Notification hook - track agent status updates
        Notification: [
          {
            timeout: 30,
            hooks: [
              (input: unknown): Promise<HookJSONOutput> => {
                const notifInput = input as NotificationHookInput;
                logger.info(
                  {
                    message: notifInput.message,
                    title: notifInput.title,
                  },
                  'Hook: Notification'
                );
                return Promise.resolve({});
              },
            ],
          },
        ],

        // PreCompact hook - log trigger reason and context
        PreCompact: [
          {
            timeout: 30,
            hooks: [
              (input: unknown): Promise<HookJSONOutput> => {
                const compactInput = input as PreCompactHookInput;
                logger.info(
                  {
                    trigger: compactInput.trigger,
                    customInstructions: compactInput.custom_instructions
                      ? `${compactInput.custom_instructions.slice(0, 100)}...`
                      : undefined,
                  },
                  'Hook: PreCompact — context compaction starting'
                );
                return Promise.resolve({});
              },
            ],
          },
        ],

        // SubagentStart hook - track subagent spawning with timing
        SubagentStart: [
          {
            timeout: 30,
            hooks: [
              (input: unknown): Promise<HookJSONOutput> => {
                const startInput = input as SubagentStartHookInput;
                const agentId = startInput.agent_id;
                subagentStartTimes.set(agentId, Date.now());
                logger.info(
                  {
                    agentId,
                    agentType: startInput.agent_type,
                  },
                  'Hook: SubagentStart — subagent spawned'
                );
                return Promise.resolve({});
              },
            ],
          },
        ],

        // SubagentStop hook - compute subagent duration
        SubagentStop: [
          {
            timeout: 30,
            hooks: [
              (input: unknown): Promise<HookJSONOutput> => {
                const stopInput = input as SubagentStopHookInput;
                // SubagentStop doesn't provide agent_id directly, so log what we have
                logger.info(
                  {
                    stopHookActive: stopInput.stop_hook_active,
                  },
                  'Hook: SubagentStop — subagent completed'
                );
                return Promise.resolve({});
              },
            ],
          },
        ],

        // SessionStart hook - log session config snapshot
        SessionStart: [
          {
            timeout: 30,
            hooks: [
              (input: unknown): Promise<HookJSONOutput> => {
                const sessionInput = input as SessionStartHookInput;
                logger.info(
                  {
                    source: sessionInput.source,
                    model: this.model ?? 'sonnet',
                    thinkingMode: this._thinkingMode,
                    thinkingBudget: this._thinkingBudget,
                    planMode: this._planMode,
                    acceptMode: this._acceptMode,
                    sessionMode: this._sessionMode,
                    mcpServers: Object.keys(this._mcpServers),
                  },
                  'Hook: SessionStart — session config snapshot'
                );
                return Promise.resolve({});
              },
            ],
          },
        ],

        // SessionEnd hook - log end reason
        SessionEnd: [
          {
            timeout: 30,
            hooks: [
              (input: unknown): Promise<HookJSONOutput> => {
                const sessionInput = input as SessionEndHookInput;
                logger.info(
                  {
                    reason: sessionInput.reason,
                  },
                  'Hook: SessionEnd — session ended'
                );
                return Promise.resolve({});
              },
            ],
          },
        ],

        // UserPromptSubmit hook - injects mode-specific context per-turn.
        //
        // Handles three cases (composable):
        //   1. Plan mode: inject the plan-mode directive + plan file path
        //   2. Debug mode (first turn): capture the user's prompt as the
        //      session goal and inject the Debug-mode preamble
        //   3. Debug mode (every N turns): inject a review-checkpoint
        //      directive asking the agent to call AskUserQuestion
        UserPromptSubmit: [
          {
            timeout: 30,
            hooks: [
              (input: unknown): Promise<HookJSONOutput> => {
                const parts: string[] = [];

                // --- Plan mode context injection ---
                if (this._planMode && this._planFilePath) {
                  const planExists = fs.existsSync(this._planFilePath);
                  parts.push(
                    `Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits (with the exception of the plan file mentioned below), run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supercedes any other instructions you have received.

## Plan File Info:
${
  planExists
    ? `Your plan is at ${this._planFilePath}. Edit it incrementally.`
    : `No plan file exists yet. You should create your plan at ${this._planFilePath} using the Write tool.`
}
You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.`
                  );
                }

                // --- Debug mode context injection ---
                if (this._debugMode) {
                  // Capture the goal on the first user turn (if configured
                  // to use 'firstMessage' which is the default).
                  const promptText = (() => {
                    const p = (input as { prompt?: unknown })?.prompt;
                    return typeof p === 'string' ? p : '';
                  })();

                  if (this._debugGoal === null && promptText.trim().length > 0) {
                    this._debugGoal = promptText.trim();
                    this._debugTurnsSinceReview = 0;
                    logger.info(
                      { goalPreview: this._debugGoal.slice(0, 120) },
                      'Debug mode — captured session goal from first prompt'
                    );
                  }

                  // Always pin the goal into the system context while Debug is on.
                  parts.push(
                    `Debug mode is active. Continuously evaluate your work against the user's stated goal for this session:

"""
${this._debugGoal ?? '(goal will be captured from this message)'}
"""

When you complete a coherent unit of work, invoke the AskUserQuestion tool to run a structured review. Prefer 3–5 targeted questions picked from:
- Problems the user has flagged or you suspect
- Improvements to propose
- What the user actually wants (vs. what you inferred)
- Whether the goal has been met (yes/no + evidence)
- Whether the technical implementation satisfies the goal
- Software improvements worth making now
- Business / UX / correctness gaps

Do NOT overwhelm the user with a full checklist every time — pick the most important items given the current session state.`
                  );

                  // Periodic review trigger: every N turns, nudge the agent
                  // to run a review explicitly before doing more work.
                  this._debugTurnsSinceReview += 1;
                  if (this._debugTurnsSinceReview >= this._debugReviewInterval) {
                    parts.push(
                      `[Debug-mode review checkpoint] It has been ${this._debugTurnsSinceReview} turns since the last user-facing check-in. Before processing further, invoke the AskUserQuestion tool with a concise review aligned to the session goal above.`
                    );
                    this._debugTurnsSinceReview = 0;
                  }
                }

                if (parts.length === 0) return Promise.resolve({});

                logger.info(
                  {
                    planMode: this._planMode,
                    debugMode: this._debugMode,
                    goalCaptured: this._debugGoal !== null,
                  },
                  'Hook: UserPromptSubmit — injecting mode-specific context'
                );

                return Promise.resolve({
                  hookSpecificOutput: {
                    hookEventName: 'UserPromptSubmit' as const,
                    additionalContext: parts.join('\n\n'),
                  },
                });
              },
            ],
          },
        ],
      };
    }

    // Add model if specified
    if (this.model) {
      options.model = this.model;
      logger.info({ model: this.model }, 'Using model');
    }

    // Add fallback model if specified
    if (this._fallbackModel) {
      options.fallbackModel = this._fallbackModel;
      logger.info({ fallbackModel: this._fallbackModel }, 'Fallback model configured');
    }

    // Output-token cap — Claude Code reads CLAUDE_CODE_MAX_OUTPUT_TOKENS from env.
    // The runtime clamps it to the active model's upperLimit server-side, so we
    // don't need to know per-model caps here; the model registry's max_output_tokens
    // is the authoritative ceiling.
    if (this._maxTokens !== undefined) {
      options.env = {
        ...process.env,
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(this._maxTokens),
      };
      logger.info({ maxTokens: this._maxTokens }, 'Output-token cap configured');
    }

    // Permission mode — always `'default'` so our `canUseTool` callback is
    // the single decision point. This is deliberate:
    //
    //   - The SDK's `'acceptEdits'` / `'bypassPermissions'` modes are set at
    //     session creation and cannot be un-set mid-turn; if we configured
    //     `'acceptEdits'` when the user started in Accept mode, toggling OUT
    //     of Accept mid-turn would have no effect on Write/Edit tools (the
    //     SDK would keep auto-approving them) until the session was rebuilt.
    //   - With `'default'`, every tool use is routed through `canUseTool`,
    //     which reads `_acceptMode` / `_planMode` / `_debugMode` via live
    //     getters on the PermissionManager. Toggling any mode at any time —
    //     including while a turn is actively streaming — takes effect on
    //     the next tool call with no session restart.
    //   - Plan mode is enforced via the UserPromptSubmit hook (soft) and
    //     canUseTool (hard). Never use the SDK's `'plan'` mode because it
    //     blocks ALL writes before canUseTool fires, which would prevent
    //     the agent from writing to its own plan file.
    options.permissionMode = 'default' as PermissionMode;
    logger.info(
      {
        acceptMode: this._acceptMode,
        planMode: this._planMode,
        debugMode: this._debugMode,
      },
      "Permission mode set to 'default' — runtime gating via canUseTool"
    );

    // Enable streaming partial messages for real-time text streaming
    options.includePartialMessages = true;

    // Session resume/fork options
    if (this._resumeSessionId) {
      options.resume = this._resumeSessionId;
      if (this._forkSession) {
        options.forkSession = true;
      }
      logger.info(
        { resumeFrom: this._resumeSessionId, fork: this._forkSession },
        'Session resume/fork configured'
      );
    }

    // MCP servers (DevTools, custom tools, etc.)
    if (Object.keys(this._mcpServers).length > 0) {
      options.mcpServers = this._mcpServers;
      logger.info({ servers: Object.keys(this._mcpServers) }, 'MCP servers configured');
    }

    // Structured output format (JSON Schema)
    if (this._outputFormat) {
      options.outputFormat = this._outputFormat;
      logger.info({ type: this._outputFormat.type }, 'Structured output format configured');
    }

    // Custom subagents for Task tool
    if (this._agents && Object.keys(this._agents).length > 0) {
      options.agents = this._agents;
      logger.info({ agents: Object.keys(this._agents) }, 'Custom subagents configured');
    }

    return options;
  }

  async startSession(): Promise<void> {
    /**
     * Start a persistent streaming session with Claude.
     * Creates a message queue and starts the query with streaming input.
     *
     * Authentication priority:
     * 1. OAuth token from ~/.claude/.credentials.json (same as Claude Code CLI)
     * 2. API key from .env file (fallback)
     */

    if (this.sessionActive) {
      logger.warn('Session already active');
      return;
    }

    // Fix PATH for production Electron apps launched from Finder/Dock
    // These don't inherit the user's shell PATH, so node/npm won't be found
    const currentPath = process.env.PATH ?? '';
    const homeDir = process.env.HOME ?? '';
    const additionalPaths = [
      '/opt/homebrew/bin', // Homebrew on Apple Silicon
      '/usr/local/bin', // Homebrew on Intel Macs
      '/usr/bin', // System binaries
      `${homeDir}/.nvm/versions/node/v22.11.0/bin`, // Common nvm path
      `${homeDir}/.nvm/versions/node/v20.18.0/bin`, // Another common nvm path
      `${homeDir}/.fnm/node-versions/v22.11.0/installation/bin`, // fnm path
    ].filter((p) => !currentPath.includes(p));

    if (additionalPaths.length > 0) {
      process.env.PATH = [...additionalPaths, currentPath].join(':');
      logger.debug({ addedPaths: additionalPaths }, 'Fixed PATH for Electron app');
    }

    // Get credentials with OAuth-first priority
    const credentials = await ClaudeCredentials.getCredentials();

    if (!credentials.hasCredentials) {
      throw new Error(
        'No credentials found. Please either:\n' +
          '1. Run "claude login" to set up OAuth credentials in ~/.claude/.credentials.json, OR\n' +
          '2. Set ANTHROPIC_API_KEY in .env file'
      );
    }

    // Handle OAuth token case
    if (credentials.type === 'oauth') {
      // Clear environment variables to force SDK to spawn Claude CLI
      // The CLI subprocess reads OAuth token from ~/.claude/.credentials.json
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_AUTH_TOKEN;

      logger.info('Using Claude Code OAuth (CLI reads from ~/.claude/.credentials.json)');
      logger.info('Note: Using your Claude subscription quota, not API credits');
    } else {
      // API key fallback case
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new Error('API key was detected but is no longer available');
      }
      logger.info('Using API key from .env (will consume API credits)');
    }

    // Set stream close timeout to allow indefinite waiting for permissions
    // Default is 60s which causes reconnects when user doesn't respond to permission prompts
    // Set to 24 hours (in milliseconds) - like Claude Code CLI, user can wait indefinitely
    process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = '86400000';

    logger.debug(
      { thinkingMode: this._thinkingMode, thinkingBudget: this._thinkingBudget },
      'Starting session'
    );

    // Create message queue
    this.messageQueue = new MessageQueue();
    this.sessionActive = true;

    // Start persistent query with streaming input
    this.currentQuery = query({
      prompt: this.messageQueue[Symbol.asyncIterator](),
      options: this._createOptions(),
    });

    logger.info('Session started successfully');
  }

  /**
   * Check if the session is ready to receive messages
   */
  isSessionReady(): boolean {
    return this.sessionActive && this.messageQueue !== null;
  }

  queueMessage(message: string, attachments?: AttachmentContentBlock[]): void {
    /**
     * Add a message to the streaming session queue.
     * The message will be processed by the ongoing query session.
     */
    if (!this.sessionActive || !this.messageQueue) {
      throw new Error('Session not started. Call startSession() first.');
    }

    // Log comprehensive SDK settings for each message
    const thinkingModeName =
      this._thinkingMode && this._thinkingBudget > 0
        ? this._thinkingBudget <= 4096
          ? 'think'
          : this._thinkingBudget <= 10240
            ? 'hard'
            : 'ultra'
        : 'off';

    logger.info(
      {
        model: this.model ?? 'sonnet',
        thinkingMode: thinkingModeName,
        thinkingBudget: this._thinkingBudget,
        thinkingEnabled: this._thinkingMode,
        planMode: this._planMode,
        acceptMode: this._acceptMode,
        critiqueMode: this._critiqueMode,
        sessionMode: this._sessionMode,
        messagePreview: message.substring(0, 80) + (message.length > 80 ? '...' : ''),
        attachmentCount: attachments?.length ?? 0,
      },
      // allow-any-unicode-next-line
      '📤 Sending message to Claude'
    );
    this.messageQueue.add(message, attachments);
  }

  async *receiveResponse(): AsyncGenerator<SDKMessage, void, unknown> {
    /**
     * Receive responses from the persistent streaming session.
     * Messages are yielded as they arrive from the query.
     */
    if (!this.currentQuery) {
      throw new Error('No active query. Call startSession() first.');
    }

    // Track tool use blocks to match with their results
    const toolUseMap = new Map<string, { name: string; input: Record<string, unknown> }>();

    // Yield messages as they arrive
    // In streaming mode, the query continues running and processing messages from the queue
    for await (const message of this.currentQuery) {
      // Capture session ID from system:init message
      if (message.type === 'system' && (message as { subtype?: string }).subtype === 'init') {
        const initMessage = message as { session_id?: string };
        if (initMessage.session_id) {
          this._currentSessionId = initMessage.session_id;
        }
      }

      // Track tool use blocks from assistant messages
      if (message.type === 'assistant') {
        const contentArray = getMessageContentArray(message);
        if (contentArray !== null) {
          for (const block of contentArray) {
            if (isToolUseBlock(block)) {
              toolUseMap.set(block.id, {
                name: block.name,
                input: block.input,
              });
            }
          }
        }
      }

      // Format tool results in user messages
      if (message.type === 'user') {
        const contentArray = getMessageContentArray(message);
        if (contentArray !== null) {
          // Create a shallow copy of the message for formatting
          const msg = message as { message: { content: unknown } };
          const formattedContent = contentArray.map((block: unknown) => {
            if (isToolResultBlock(block)) {
              const toolInfo = toolUseMap.get(block.tool_use_id);
              if (toolInfo !== undefined) {
                // Format the content
                const formatted = formatToolResult(
                  toolInfo.name,
                  toolInfo.input,
                  block.content,
                  block.is_error === true
                );
                return { ...block, content: formatted };
              }
            }
            return block;
          });
          const formattedMessage = {
            ...message,
            message: { ...msg.message, content: formattedContent },
          };
          yield formattedMessage as SDKMessage;
        } else {
          yield message;
        }
      } else {
        yield message;
      }
    }

    // Query completed (session ended)
    logger.debug('Query session completed');
    this.sessionActive = false;
    this.currentQuery = null;
  }

  async stopSession(): Promise<void> {
    /**
     * Stop the streaming session and clean up resources.
     */
    if (!this.sessionActive) {
      logger.debug('Session not active');
      return;
    }

    logger.debug('Stopping session');

    // Stop the message queue
    if (this.messageQueue) {
      this.messageQueue.stop();
      this.messageQueue = null;
    }

    // Interrupt the query if still running
    if (this.currentQuery) {
      try {
        await this.currentQuery.interrupt();
      } catch (error) {
        logger.error({ error }, 'Error interrupting query');
      }
      this.currentQuery = null;
    }

    this.sessionActive = false;
    logger.info('Session stopped');
  }

  async interrupt(): Promise<void> {
    /**
     * Interrupt the current query execution.
     */
    if (!this.currentQuery) {
      throw new Error('No active query to interrupt.');
    }

    logger.info('Interrupting current query');
    await this.currentQuery.interrupt();
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    /**
     * Change permission mode during execution.
     */
    if (!this.currentQuery) {
      throw new Error('No active query.');
    }

    await this.currentQuery.setPermissionMode(mode);
  }

  isConnected(): boolean {
    /**
     * Check if agent has an active query.
     */
    return this.currentQuery !== null;
  }

  async setThinkingMode(enabled: boolean, maxTokens?: number): Promise<void> {
    this._thinkingMode = enabled;
    if (maxTokens !== undefined) {
      this._thinkingBudget = maxTokens;
    }

    // Update running query if exists - this is the key fix!
    // Without this, thinking mode changes wouldn't take effect mid-session
    if (this.currentQuery) {
      const budget = enabled && this._thinkingBudget > 0 ? this._thinkingBudget : null;
      await this.currentQuery.setMaxThinkingTokens(budget);

      const modeName =
        budget === null ? 'off' : budget <= 4096 ? 'think' : budget <= 10240 ? 'hard' : 'ultra';
      logger.info({ thinkingMode: modeName, budget }, 'Thinking mode updated mid-session');
    }
  }

  getThinkingMode(): boolean {
    return this._thinkingMode;
  }

  setPlanMode(enabled: boolean): void {
    this._planMode = enabled;
    // Disable accept mode if plan mode is being enabled
    if (enabled) {
      this._acceptMode = false;
      // Generate plan file path and ensure directory exists
      if (!this._planFilePath) {
        const planName = generatePlanName();
        this._planFilePath = getPlanFilePath(planName, this.cwd);
        ensurePlanDirectory(this.cwd);
        logger.info({ planName, planFilePath: this._planFilePath }, 'Plan file path generated');
      }
    } else {
      // Clear plan file path when plan mode is disabled
      this._planFilePath = null;
    }

    // Plan mode is enforced dynamically via PermissionManager callback
    // Write tools are denied immediately; read-only tools continue to work
    // UserPromptSubmit hook injects plan mode system prompt per-turn (soft enforcement)
    logger.info({ enabled, planFilePath: this._planFilePath }, 'Plan mode changed - will take effect on next tool use');
  }

  getPlanMode(): boolean {
    return this._planMode;
  }

  getPlanFilePath(): string | null {
    return this._planFilePath;
  }

  setAcceptMode(enabled: boolean): void {
    this._acceptMode = enabled;
    // Disable plan mode if accept mode is being enabled
    if (enabled) {
      this._planMode = false;
    }

    // Accept mode is checked dynamically in permission callback
    // No session restart needed - takes effect immediately on next tool use
    logger.info({ enabled }, 'Accept mode changed - will take effect on next tool use');
  }

  getAcceptMode(): boolean {
    return this._acceptMode;
  }

  /**
   * Enable/disable Debug mode. Turning it on captures the next user prompt
   * as the session goal; turning it off clears any captured goal.
   */
  setDebugMode(enabled: boolean): void {
    this._debugMode = enabled;
    if (!enabled) {
      this._debugGoal = null;
      this._debugTurnsSinceReview = 0;
    } else {
      // Mutually exclusive with Plan/Accept, matching the frontend selector.
      this._planMode = false;
      this._acceptMode = false;
    }
    logger.info({ enabled }, 'Debug mode changed');
  }

  getDebugMode(): boolean {
    return this._debugMode;
  }

  /** Read the captured goal (set lazily by the UserPromptSubmit hook). */
  getDebugGoal(): string | null {
    return this._debugGoal;
  }

  setCritiqueMode(enabled: boolean): void {
    this._critiqueMode = enabled;
  }

  getCritiqueMode(): boolean {
    return this._critiqueMode;
  }

  async setModel(model: string): Promise<void> {
    this.model = model;

    // Update running query if exists - this enables runtime model switching
    if (this.currentQuery) {
      await this.currentQuery.setModel(model);
      logger.info({ model }, 'Model updated mid-session via Query.setModel()');
    }
  }

  getModel(): string {
    return this.model ?? 'sonnet';
  }

  /**
   * Get the current SDK session ID
   * This is captured from the system:init message when the session starts
   */
  getCurrentSessionId(): string | undefined {
    return this._currentSessionId;
  }
}

/**
 * Create an Orbit agent.
 */
export function createAgent(config: OrbitAgentConfig = {}): OrbitAgent {
  return new OrbitAgent(config);
}
