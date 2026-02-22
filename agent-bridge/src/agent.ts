/**
 * Claude Agent SDK integration for Orbit Editor (TypeScript).
 */

import { query } from '@anthropic-ai/claude-agent-sdk';

import { ClaudeCredentials } from './credentials.js';
import { createLogger } from './logger.js';
import { PermissionManager } from './permissions.js';
import { getAllowedToolsForMode } from './session-mode.js';
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
  planEnabled?: boolean;
  acceptEnabled?: boolean;
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
  private _acceptMode: boolean;
  private _critiqueMode: boolean;
  private model?: string;
  private _fallbackModel?: string;
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
      () => this._acceptMode // Pass Accept mode getter for dynamic checking
    );
    this.cwd = config.cwd ?? process.cwd();
    this._thinkingMode = config.thinkingEnabled ?? false;
    this._thinkingBudget = config.maxThinkingTokens ?? 0; // 0=off, 4096=think, 10240=hard, 32768=ultra
    this._planMode = config.planEnabled ?? false;
    this._acceptMode = config.acceptEnabled ?? false;
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
    this._mcpServers = config.mcpServers ?? {};
    this._outputFormat = config.outputFormat;
    this._agents = config.agents;
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

    // Permission mode (UDE pattern)
    // - Accept mode: 'acceptEdits' - SDK auto-approves all tools
    // - Plan mode: 'plan' - SDK restricts to read-only tools
    // - Default mode: 'default' - canUseTool callback handles all permissions
    const permissionMode: PermissionMode = this._acceptMode
      ? 'acceptEdits'
      : this._planMode
        ? 'plan'
        : 'default'; // UDE uses 'default' and it works
    options.permissionMode = permissionMode;
    logger.info({ permissionMode }, 'Permission mode set');

    if (this._planMode) {
      logger.info('Plan mode ENABLED - SDK will restrict to read-only tools');
    }

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

  startSession(): void {
    /**
     * Start a persistent streaming session with Claude.
     * Creates a message queue and starts the query with streaming input.
     *
     * Authentication priority:
     * 1. OAuth token from macOS Keychain (same as Claude Code CLI)
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
    const credentials = ClaudeCredentials.getCredentials();

    if (!credentials.hasCredentials) {
      throw new Error(
        'No credentials found. Please either:\n' +
          '1. Log in to Claude Code CLI (OAuth token will be stored in macOS Keychain), OR\n' +
          '2. Set ANTHROPIC_API_KEY in .env file'
      );
    }

    // Handle OAuth token case
    if (credentials.type === 'oauth') {
      // Clear environment variables to force SDK to spawn Claude CLI
      // The CLI subprocess will read OAuth token from Keychain internally
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_AUTH_TOKEN;

      logger.info('Using Claude Code OAuth (CLI will read from Keychain)');
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
    }

    // Plan mode is checked when creating new sessions
    // Existing sessions continue with their current mode to avoid interruption
    logger.info({ enabled }, 'Plan mode changed - will apply to next session');
  }

  getPlanMode(): boolean {
    return this._planMode;
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
