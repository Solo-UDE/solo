/**
 * Session Manager for Orbit Editor Agent Bridge
 * Manages Claude Agent SDK sessions and message streaming
 */

import { randomUUID } from 'node:crypto';

import { OrbitAgent } from './agent.js';
import { Disposable, Emitter } from './events.js';
import { createLogger, setCorrelationId } from './logger.js';

import type { OrbitAgentConfig } from './agent.js';
import type { AttachmentContentBlock } from './messages.js';

const logger = createLogger('SessionManager');

// =============================================================================
// Agent Message Types
// =============================================================================

/**
 * Agent message types sent to the frontend
 */
export interface AgentMessage {
  type: 'text' | 'thinking' | 'tool_use' | 'result' | 'error';
  content: string;
  metadata?: {
    toolName?: string;
    toolId?: string;
    toolInput?: Record<string, unknown>;
    toolOutput?: string;
    status?: 'awaiting-permission' | 'running' | 'success' | 'error';
  };
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  };
  totalCostUsd?: number;
  durationMs?: number;
  structuredOutput?: unknown;
  resultSubtype?: string;
}

/**
 * Permission request sent to the frontend
 */
export interface PermissionRequest {
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  requestId: string;
}

/**
 * Permission response from the frontend
 */
export interface PermissionResponse {
  requestId: string;
  decision: 'approve' | 'deny';
  always: boolean;
  answers?: Record<string, string>;
}

/**
 * Session initialization event
 */
export interface SessionInitEvent {
  sessionId: string;
  sdkSessionId: string;
  isResumed: boolean;
  isForked: boolean;
}

/**
 * Serializable error for IPC
 */
export interface SerializableError {
  message: string;
  stack?: string;
}

/**
 * Session configuration
 */
export interface SessionConfig {
  cwd?: string;
  thinkingEnabled?: boolean;
  maxThinkingTokens?: number;
  planEnabled?: boolean;
  acceptEnabled?: boolean;
  critiqueEnabled?: boolean;
  model?: string;
  /** Output-token cap forwarded to the SDK (Claude Code's CLAUDE_CODE_MAX_OUTPUT_TOKENS). */
  maxTokens?: number;
  /**
   * Explicit per-session tool allow-list. When present, the SDK is started
   * with this exact list and no other tools are callable. Used by the Git
   * Agent harness to restrict the model to git + read-only file operations.
   */
  allowedTools?: string[];
  sessionMode?: 'chat' | 'agent';
  resumeSessionId?: string;
  forkSession?: boolean;
}

/**
 * Permission resolver - resolves when user responds to permission request
 */
type PermissionResolver = (response: {
  decision: 'approve' | 'deny';
  always: boolean;
  answers?: Record<string, string>;
}) => void;

/**
 * Tool result block interface
 */
interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: unknown;
  is_error?: boolean;
}

/**
 * SDK message content block types
 */
interface TextBlock {
  type: 'text';
  text?: string;
}

interface ThinkingBlock {
  type: 'thinking';
  thinking?: string;
}

interface ToolUseBlock {
  type: 'tool_use';
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock;

/**
 * SDK stream event delta
 */
interface StreamDelta {
  type: string;
  text?: string;
  thinking?: string;
}

/**
 * SDK stream event
 */
interface StreamEvent {
  type: string;
  index?: number;
  delta?: StreamDelta;
  content_block?: { type: string; [key: string]: unknown };
}

/**
 * SDK message types
 */
interface SDKSystemMessage {
  type: 'system';
  subtype?: string;
  session_id?: string;
}

interface SDKStreamEventMessage {
  type: 'stream_event';
  event?: StreamEvent;
}

interface SDKAssistantMessage {
  type: 'assistant';
  message?: {
    content?: ContentBlock[];
  };
}

interface SDKUserMessage {
  type: 'user';
  message?: {
    content?: unknown[];
  };
}

interface SDKResultMessage {
  type: 'result';
  subtype?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  total_cost_usd?: number;
  duration_ms?: number;
  structured_output?: unknown;
}

type SDKMessage =
  | SDKSystemMessage
  | SDKStreamEventMessage
  | SDKAssistantMessage
  | SDKUserMessage
  | SDKResultMessage;

/**
 * Entry in the per-session tool use map.
 * Tracks tool_use blocks so we can:
 *   1. Correlate permission callbacks with the correct toolId
 *   2. Match tool_result blocks back to their tool_use origin
 */
interface ToolUseEntry {
  name: string;
  input: Record<string, unknown>;
  /** True once the permission callback has resolved for this tool */
  permissionResolved: boolean;
}

/**
 * Type guard for tool_result blocks
 */
function isToolResultBlock(block: unknown): block is ToolResultBlock {
  if (typeof block !== 'object' || block === null) {
    return false;
  }
  const obj = block as Record<string, unknown>;
  return obj.type === 'tool_result' && typeof obj.tool_use_id === 'string';
}

/**
 * Safely get string value with fallback
 */
function getString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Generate unique tool ID
 */
function generateToolId(): string {
  return `tool_${String(Date.now())}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Session Manager - orchestrates Claude Agent SDK sessions
 *
 * State tracking is minimal:
 *   - activeSessions: agent instances
 *   - permissionResolvers: pending permission request → resolver
 *   - sessionToolUseMaps: per-session tool_use → tool_result correlation
 */
export class SessionManager extends Disposable {
  // Event emitters
  private readonly _onError = this._register(new Emitter<SerializableError>());
  readonly onError = this._onError.event;

  private readonly _onPermissionRequest = this._register(new Emitter<PermissionRequest>());
  readonly onPermissionRequest = this._onPermissionRequest.event;

  private readonly _onAgentMessage = this._register(
    new Emitter<{ sessionId: string; message: AgentMessage }>()
  );
  readonly onAgentMessage = this._onAgentMessage.event;

  private readonly _onPlanModeChanged = this._register(
    new Emitter<{ sessionId: string; enabled: boolean; planFilePath: string | null }>()
  );
  readonly onPlanModeChanged = this._onPlanModeChanged.event;

  private readonly _onAcceptModeChanged = this._register(
    new Emitter<{ sessionId: string; enabled: boolean }>()
  );
  readonly onAcceptModeChanged = this._onAcceptModeChanged.event;

  private readonly _onDebugModeChanged = this._register(
    new Emitter<{ sessionId: string; enabled: boolean }>()
  );
  readonly onDebugModeChanged = this._onDebugModeChanged.event;

  private readonly _onSessionGoalCaptured = this._register(
    new Emitter<{ sessionId: string; goal: string; capturedAt: number }>()
  );
  readonly onSessionGoalCaptured = this._onSessionGoalCaptured.event;

  private readonly _onSessionInit = this._register(new Emitter<SessionInitEvent>());
  readonly onSessionInit = this._onSessionInit.event;

  // Session tracking
  private activeSessions = new Map<string, OrbitAgent>();
  private sessionConsumers = new Map<string, { cancel: () => void }>();
  private permissionResolvers = new Map<string, PermissionResolver>();
  /**
   * Per-session map of pending permission requestIds → the tool call that
   * triggered them. Stores the tool name + input so `drainPendingPermissions`
   * can re-run the pipeline against each pending prompt under the new mode
   * — we only auto-resolve prompts whose new decision actually differs
   * (Accept + pipeline→allow, or Plan + pipeline→deny), leaving destructive
   * and ask-ruled prompts in place so the user still sees them.
   */
  private pendingRequestsBySession = new Map<
    string,
    Map<string, { toolName: string; toolInput: Record<string, unknown> }>
  >();
  private modePreferences = new Map<
    string,
    {
      thinkingEnabled?: boolean;
      maxThinkingTokens?: number;
      planEnabled?: boolean;
      acceptEnabled?: boolean;
      debugEnabled?: boolean;
      critiqueEnabled?: boolean;
      model?: string;
      maxTokens?: number;
    }
  >();

  /** Last observed goal per session — used to debounce SessionGoalCaptured emissions. */
  private sessionGoals = new Map<string, string>();
  /** Polls active agents for a newly-captured Debug goal, emits the event once. */
  private goalPollers = new Map<string, NodeJS.Timeout>();
  private sessionResumeState = new Map<string, { isResumed: boolean; isForked: boolean }>();
  private sessionInitFired = new Set<string>();

  /**
   * Per-session tool use maps — shared between the background consumer
   * and the permission callback so the callback can look up the correct
   * toolId when emitting 'running' status.
   */
  private sessionToolUseMaps = new Map<string, Map<string, ToolUseEntry>>();

  // ==========================================================================
  // Session Lifecycle
  // ==========================================================================

  /**
   * Create a new agent session
   */
  async createSession(sessionId: string, config?: SessionConfig): Promise<void> {
    if (this.activeSessions.has(sessionId)) {
      return;
    }

    // Initialize shared tool use map for this session
    const toolUseMap = new Map<string, ToolUseEntry>();
    this.sessionToolUseMaps.set(sessionId, toolUseMap);

    // Create permission callback that fires events
    const permissionCallback = async (
      toolName: string,
      toolInput: Record<string, unknown>,
      _context: { signal: AbortSignal; suggestions?: unknown[] }
    ): Promise<{
      decision: 'approve' | 'deny';
      always: boolean;
      answers?: Record<string, string>;
    }> => {
      const requestId = randomUUID();

      // Register in the session → requestId-to-toolcall index so mid-turn
      // mode toggles can re-evaluate each pending prompt under the new mode
      // and auto-resolve the ones whose decision would change.
      let pendingForSession = this.pendingRequestsBySession.get(sessionId);
      if (!pendingForSession) {
        pendingForSession = new Map();
        this.pendingRequestsBySession.set(sessionId, pendingForSession);
      }
      pendingForSession.set(requestId, { toolName, toolInput });

      // Fire event to frontend
      this._onPermissionRequest.fire({
        sessionId,
        toolName,
        toolInput,
        requestId,
      });

      // Wait for response (no timeout - waits indefinitely)
      const result = await new Promise<{
        decision: 'approve' | 'deny';
        always: boolean;
        answers?: Record<string, string>;
      }>((resolve) => {
        this.permissionResolvers.set(requestId, resolve);
      });

      // Clean up the reverse-index entry now that the resolver has fired.
      pendingForSession.delete(requestId);
      if (pendingForSession.size === 0) {
        this.pendingRequestsBySession.delete(sessionId);
      }

      // If approved, emit 'running' for the specific tool
      if (result.decision === 'approve') {
        if (toolName === 'ExitPlanMode') {
          agent.setPlanMode(false);
          const prefs = this.modePreferences.get(sessionId) ?? {};
          prefs.planEnabled = false;
          this.modePreferences.set(sessionId, prefs);
          this._onPlanModeChanged.fire({ sessionId, enabled: false, planFilePath: null });
        }

        // Find the FIRST pending tool with this name whose permission
        // hasn't been resolved yet. The SDK calls canUseTool in order,
        // so FIFO matching is correct even for parallel same-name tools.
        const sessionMap = this.sessionToolUseMaps.get(sessionId);
        if (sessionMap) {
          for (const [toolId, entry] of sessionMap) {
            if (entry.name === toolName && !entry.permissionResolved) {
              entry.permissionResolved = true;
              this._onAgentMessage.fire({
                sessionId,
                message: {
                  type: 'tool_use',
                  content: `Tool ${toolName} running`,
                  metadata: {
                    toolName,
                    toolId,
                    toolInput: entry.input,
                    status: 'running',
                  },
                },
              });
              break;
            }
          }
        }
      }

      return result;
    };

    // Merge stored preferences with config
    const storedPrefs = this.modePreferences.get(sessionId);
    const finalConfig: OrbitAgentConfig = {
      thinkingEnabled: storedPrefs?.thinkingEnabled ?? config?.thinkingEnabled ?? false,
      maxThinkingTokens: storedPrefs?.maxThinkingTokens ?? config?.maxThinkingTokens,
      planEnabled: storedPrefs?.planEnabled ?? config?.planEnabled ?? false,
      acceptEnabled: storedPrefs?.acceptEnabled ?? config?.acceptEnabled ?? false,
      debugEnabled: storedPrefs?.debugEnabled ?? false,
      critiqueEnabled: storedPrefs?.critiqueEnabled ?? config?.critiqueEnabled ?? false,
      model: storedPrefs?.model ?? config?.model,
      maxTokens: storedPrefs?.maxTokens ?? config?.maxTokens,
      allowedTools: config?.allowedTools,
      cwd: config?.cwd,
      sessionMode: config?.sessionMode ?? 'agent',
      permissionRequestCallback: permissionCallback,
      resumeSessionId: config?.resumeSessionId,
      forkSession: config?.forkSession,
    };

    logger.info({ sessionId, sessionMode: finalConfig.sessionMode }, 'Creating session');

    const agent = new OrbitAgent(finalConfig);

    // Track resume/fork state
    this.sessionResumeState.set(sessionId, {
      isResumed: !!config?.resumeSessionId,
      isForked: !!config?.forkSession,
    });

    this.activeSessions.set(sessionId, agent);

    try {
      await agent.startSession();
      logger.info({ sessionId }, 'Session started successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ sessionId, error: errorMessage }, 'Failed to start session');
      throw error;
    }

    // Start background consumer for real-time streaming
    this._startBackgroundConsumer(sessionId, agent);
  }

  /**
   * Start a background consumer for streaming messages.
   */
  private _startBackgroundConsumer(sessionId: string, agent: OrbitAgent): void {
    const state = { cancelled: false };

    const cancel = (): void => {
      state.cancelled = true;
    };

    this.sessionConsumers.set(sessionId, { cancel });

    // Run consumer in background
    void (async () => {
      try {
        // Get the shared tool use map (created in createSession)
        const toolUseMap = this.sessionToolUseMaps.get(sessionId)!;

        for await (const rawMessage of agent.receiveResponse()) {
          if (state.cancelled) {
            break;
          }

          // Cast to typed SDK message
          const sdkMessage = rawMessage as SDKMessage;

          // =================================================================
          // system messages
          // =================================================================
          if (sdkMessage.type === 'system') {
            logger.debug({ sessionId, subtype: sdkMessage.subtype }, 'SDK system message');

            if (sdkMessage.subtype === 'init' && sdkMessage.session_id !== undefined) {
              if (this.sessionInitFired.has(sessionId)) {
                continue;
              }
              this.sessionInitFired.add(sessionId);

              const resumeState = this.sessionResumeState.get(sessionId) ?? {
                isResumed: false,
                isForked: false,
              };
              this._onSessionInit.fire({
                sessionId,
                sdkSessionId: sdkMessage.session_id,
                isResumed: resumeState.isResumed,
                isForked: resumeState.isForked,
              });
            }
            continue;
          }

          // =================================================================
          // stream_event — text and thinking deltas
          // =================================================================
          if (sdkMessage.type === 'stream_event') {
            const event = sdkMessage.event;
            if (event === undefined) continue;

            if (event.type === 'content_block_delta') {
              const deltaType = event.delta?.type;

              if (deltaType === 'text_delta') {
                const textDelta = event.delta?.text;
                if (textDelta !== undefined) {
                  this._onAgentMessage.fire({
                    sessionId,
                    message: { type: 'text', content: textDelta },
                  });
                }
              } else if (deltaType === 'thinking_delta') {
                const thinkingDelta = event.delta?.thinking;
                if (thinkingDelta !== undefined) {
                  this._onAgentMessage.fire({
                    sessionId,
                    message: { type: 'thinking', content: thinkingDelta },
                  });
                }
              }
            }
            continue;
          }

          // =================================================================
          // assistant messages — tool_use blocks
          // =================================================================
          if (sdkMessage.type === 'assistant') {
            const content = sdkMessage.message?.content;
            if (content === undefined) continue;

            for (const block of content) {
              // Skip text blocks (already streamed via deltas)
              if (block.type === 'text') {
                continue;
              }
              if (block.type === 'thinking') {
                this._onAgentMessage.fire({
                  sessionId,
                  message: {
                    type: 'thinking',
                    content: block.thinking ?? '',
                  },
                });
                continue;
              }

              // block.type === 'tool_use'
              const toolName = getString(block.name, 'unknown');
              const toolId = getString(block.id) || generateToolId();
              const toolInput = block.input ?? {};

              logger.info({ sessionId, toolName, toolId }, 'Tool use block received');

              // Pre-decide the permission outcome so the UI never sees an
              // `awaiting-permission` card for tools that are about to be
              // auto-approved. Without this, every auto-approved tool would
              // flash a `<ToolApprovalCard>` for one render frame before the
              // `tool_result` downgrades it to `success`.
              //
              // The pipeline is pure + synchronous; it reads `.solo/settings.json`
              // via an mtime cache so the subsequent real call from `canUseTool`
              // reuses the parse.
              const previewed = agent.previewPermission(
                toolName,
                toolInput as Record<string, unknown>
              );
              const initialStatus =
                previewed === 'ask' ? 'awaiting-permission' : 'running';

              logger.debug(
                { sessionId, toolName, previewed, initialStatus },
                'Initial tool_use status resolved from preview'
              );

              const toolMessage: AgentMessage = {
                type: 'tool_use',
                content: `Using tool: ${toolName}`,
                metadata: {
                  toolName,
                  toolId,
                  toolInput,
                  status: initialStatus,
                },
              };

              // Store in shared map for:
              //   1. Permission callback to find toolId by toolName
              //   2. Tool result matching by toolId
              toolUseMap.set(toolId, {
                name: toolName,
                input: toolInput,
                permissionResolved: false,
              });

              this._onAgentMessage.fire({ sessionId, message: toolMessage });
            }
          } else if (sdkMessage.type === 'user') {
            // =================================================================
            // Tool results
            // =================================================================
            const content = sdkMessage.message?.content;
            if (!Array.isArray(content)) continue;

            for (const block of content) {
              if (isToolResultBlock(block)) {
                const toolUseId = block.tool_use_id;
                const toolInfo = toolUseMap.get(toolUseId);

                if (toolInfo !== undefined) {
                  const toolOutput =
                    typeof block.content === 'string'
                      ? block.content
                      : JSON.stringify(block.content);
                  const isError = block.is_error === true;

                  logger.info(
                    {
                      sessionId,
                      toolName: toolInfo.name,
                      toolId: toolUseId,
                      isError,
                      outputLength: toolOutput.length,
                    },
                    'Tool result received'
                  );

                  this._onAgentMessage.fire({
                    sessionId,
                    message: {
                      type: 'tool_use',
                      content: isError
                        ? `Tool ${toolInfo.name} failed`
                        : `Tool ${toolInfo.name} completed`,
                      metadata: {
                        toolName: toolInfo.name,
                        toolId: toolUseId,
                        toolInput: toolInfo.input,
                        toolOutput,
                        status: isError ? 'error' : 'success',
                      },
                    },
                  });

                  toolUseMap.delete(toolUseId);
                }
              }
            }
          } else {
            // =================================================================
            // result messages
            // =================================================================
            const resultMsg = sdkMessage;

            if (resultMsg.usage !== undefined) {
              logger.info(
                {
                  sessionId,
                  inputTokens: resultMsg.usage.input_tokens,
                  outputTokens: resultMsg.usage.output_tokens,
                  cacheRead: resultMsg.usage.cache_read_input_tokens,
                },
                'Turn complete — token usage'
              );
            }

            this._onAgentMessage.fire({
              sessionId,
              message: {
                type: 'result',
                content:
                  resultMsg.subtype === 'error_max_structured_output_retries'
                    ? 'Failed to produce valid structured output'
                    : 'Turn complete',
                usage:
                  resultMsg.usage !== undefined
                    ? {
                        inputTokens: resultMsg.usage.input_tokens ?? 0,
                        outputTokens: resultMsg.usage.output_tokens ?? 0,
                        cacheReadInputTokens: resultMsg.usage.cache_read_input_tokens,
                        cacheCreationInputTokens: resultMsg.usage.cache_creation_input_tokens,
                      }
                    : undefined,
                totalCostUsd: resultMsg.total_cost_usd,
                durationMs: resultMsg.duration_ms,
                structuredOutput: resultMsg.structured_output,
                resultSubtype: resultMsg.subtype,
              },
            });

            setCorrelationId(undefined);
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : 'no stack';
        logger.error({ sessionId, error: errorMessage }, 'Background consumer error');
        this._onError.fire({ message: `[SDK Error] ${errorMessage}`, stack: errorStack });
      }
    })();
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    const consumer = this.sessionConsumers.get(sessionId);
    if (consumer) {
      consumer.cancel();
      this.sessionConsumers.delete(sessionId);
    }

    const agent = this.activeSessions.get(sessionId);
    if (agent) {
      await agent.stopSession();
      this.activeSessions.delete(sessionId);
    }

    this.sessionToolUseMaps.delete(sessionId);
    this.sessionResumeState.delete(sessionId);
    this.sessionInitFired.delete(sessionId);
  }

  /**
   * Check if a session is ready
   */
  isSessionReady(sessionId: string): boolean {
    const agent = this.activeSessions.get(sessionId);
    return agent?.isSessionReady() ?? false;
  }

  /**
   * Interrupt a session
   */
  async interrupt(sessionId: string): Promise<void> {
    const agent = this.activeSessions.get(sessionId);
    if (!agent) {
      throw new Error(`Session ${sessionId} not found`);
    }
    await agent.interrupt();
  }

  /**
   * Get the SDK session ID for a session
   */
  getSDKSessionId(sessionId: string): string | undefined {
    const agent = this.activeSessions.get(sessionId);
    return agent?.getCurrentSessionId();
  }

  /**
   * Send a message to a session
   */
  sendMessage(message: string, sessionId: string, attachments?: AttachmentContentBlock[]): void {
    const agent = this.activeSessions.get(sessionId);
    if (agent === undefined) {
      throw new Error(`Session ${sessionId} not found. Call createSession() first.`);
    }

    if (!agent.isSessionReady()) {
      throw new Error(`Session ${sessionId} is not ready.`);
    }

    const correlationId = randomUUID();
    setCorrelationId(correlationId);

    logger.info(
      {
        sessionId,
        correlationId: correlationId.slice(0, 8),
        messagePreview: message.slice(0, 100) + (message.length > 100 ? '...' : ''),
        attachmentCount: attachments?.length ?? 0,
      },
      'Sending message'
    );

    agent.queueMessage(message, attachments);
  }

  /**
   * Respond to a permission request
   */
  respondToPermission(response: PermissionResponse): void {
    const resolver = this.permissionResolvers.get(response.requestId);
    if (resolver) {
      resolver({
        decision: response.decision,
        always: response.always,
        answers: response.answers,
      });
      this.permissionResolvers.delete(response.requestId);
    }
  }

  /**
   * Set thinking mode for a session
   */
  async setThinkingMode(sessionId: string, enabled: boolean, maxTokens?: number): Promise<void> {
    const agent = this.activeSessions.get(sessionId);
    if (!agent) {
      const prefs = this.modePreferences.get(sessionId) ?? {};
      prefs.thinkingEnabled = enabled;
      prefs.maxThinkingTokens = maxTokens;
      this.modePreferences.set(sessionId, prefs);
      return;
    }
    await agent.setThinkingMode(enabled, maxTokens);
    const prefs = this.modePreferences.get(sessionId) ?? {};
    prefs.thinkingEnabled = enabled;
    prefs.maxThinkingTokens = maxTokens;
    this.modePreferences.set(sessionId, prefs);
  }

  /**
   * Get thinking mode for a session
   */
  getThinkingMode(sessionId: string): boolean {
    const agent = this.activeSessions.get(sessionId);
    if (agent === undefined) {
      const prefs = this.modePreferences.get(sessionId);
      return prefs?.thinkingEnabled ?? false;
    }
    return agent.getThinkingMode();
  }

  /**
   * Set model for a session
   */
  async setModel(sessionId: string, model: string): Promise<void> {
    const agent = this.activeSessions.get(sessionId);
    if (!agent) {
      const prefs = this.modePreferences.get(sessionId) ?? {};
      prefs.model = model;
      this.modePreferences.set(sessionId, prefs);
      return;
    }
    await agent.setModel(model);
    const prefs = this.modePreferences.get(sessionId) ?? {};
    prefs.model = model;
    this.modePreferences.set(sessionId, prefs);
  }

  /**
   * Re-evaluate every pending permission prompt for a session under the
   * CURRENT mode and auto-resolve any whose decision would now differ.
   *
   * Called when the user toggles a mode mid-turn (Plan / Accept). The
   * pipeline is run via `agent.previewPermission(...)` so destructive /
   * ask-ruled / deny-ruled prompts are preserved (they remain bypass-immune
   * even under Accept) — only prompts whose fresh decision is `allow` get
   * auto-approved, and only prompts whose fresh decision is `deny` get
   * auto-denied. Everything else stays on-screen for the user to resolve.
   *
   * Mirrors Claude Code's semantic: pending prompts re-read the current
   * mode via `getAppState()` and behave accordingly.
   */
  private reevaluatePendingPermissions(sessionId: string): void {
    const pending = this.pendingRequestsBySession.get(sessionId);
    if (!pending || pending.size === 0) return;
    const agent = this.activeSessions.get(sessionId);
    if (!agent) return;

    const toDrain: Array<{ requestId: string; decision: 'approve' | 'deny' }> = [];
    for (const [requestId, { toolName, toolInput }] of pending) {
      const preview = agent.previewPermission(toolName, toolInput);
      if (preview === 'allow') {
        toDrain.push({ requestId, decision: 'approve' });
      } else if (preview === 'deny') {
        toDrain.push({ requestId, decision: 'deny' });
      }
      // preview === 'ask' → pipeline still wants user input; leave as-is.
    }

    if (toDrain.length === 0) return;

    logger.info(
      { sessionId, drained: toDrain.length, pendingTotal: pending.size },
      'Re-evaluated pending permission prompts after mode change'
    );

    for (const { requestId, decision } of toDrain) {
      const resolver = this.permissionResolvers.get(requestId);
      if (resolver) {
        this.permissionResolvers.delete(requestId);
        resolver({ decision, always: false });
      }
      pending.delete(requestId);
    }
    if (pending.size === 0) {
      this.pendingRequestsBySession.delete(sessionId);
    }
  }

  /**
   * Set plan mode for a session
   */
  setPlanMode(sessionId: string, enabled: boolean): void {
    const agent = this.activeSessions.get(sessionId);
    if (agent === undefined) {
      const prefs = this.modePreferences.get(sessionId) ?? {};
      prefs.planEnabled = enabled;
      this.modePreferences.set(sessionId, prefs);
      this._onPlanModeChanged.fire({ sessionId, enabled, planFilePath: null });
      return;
    }
    agent.setPlanMode(enabled);
    const planFilePath = agent.getPlanFilePath();
    const prefs = this.modePreferences.get(sessionId) ?? {};
    prefs.planEnabled = enabled;
    this.modePreferences.set(sessionId, prefs);
    this._onPlanModeChanged.fire({ sessionId, enabled, planFilePath });

    // Mode change: re-evaluate any pending prompts so the UI doesn't show
    // a stale modal for a tool the pipeline would now decide automatically.
    this.reevaluatePendingPermissions(sessionId);
  }

  /**
   * Get plan mode for a session
   */
  getPlanMode(sessionId: string): boolean {
    const agent = this.activeSessions.get(sessionId);
    if (agent === undefined) {
      const prefs = this.modePreferences.get(sessionId);
      return prefs?.planEnabled ?? false;
    }
    return agent.getPlanMode();
  }

  /**
   * Set accept mode for a session
   */
  setAcceptMode(sessionId: string, enabled: boolean): void {
    const agent = this.activeSessions.get(sessionId);
    if (!agent) {
      const prefs = this.modePreferences.get(sessionId) ?? {};
      prefs.acceptEnabled = enabled;
      this.modePreferences.set(sessionId, prefs);
      this._onAcceptModeChanged.fire({ sessionId, enabled });
      return;
    }
    agent.setAcceptMode(enabled);
    const prefs = this.modePreferences.get(sessionId) ?? {};
    prefs.acceptEnabled = enabled;
    this.modePreferences.set(sessionId, prefs);
    this._onAcceptModeChanged.fire({ sessionId, enabled });

    // Mode change: re-evaluate any pending prompts. Under Accept mode,
    // anything the pipeline now says `allow` is auto-approved; anything
    // still saying `ask` (e.g. an `ask`-ruled Bash command — bypass-immune)
    // stays on screen for the user to resolve.
    this.reevaluatePendingPermissions(sessionId);
  }

  /**
   * Get accept mode for a session
   */
  getAcceptMode(sessionId: string): boolean {
    const agent = this.activeSessions.get(sessionId);
    if (agent === undefined) {
      const prefs = this.modePreferences.get(sessionId);
      return prefs?.acceptEnabled ?? false;
    }
    return agent.getAcceptMode();
  }

  /**
   * Enable/disable Debug mode. When enabled, the first user prompt after
   * this call is captured as the session goal; a `sessionGoalCaptured` event
   * is emitted so the UI can pin the goal.
   */
  setDebugMode(sessionId: string, enabled: boolean): void {
    const agent = this.activeSessions.get(sessionId);
    if (!agent) {
      const prefs = this.modePreferences.get(sessionId) ?? {};
      prefs.debugEnabled = enabled;
      this.modePreferences.set(sessionId, prefs);
      this._onDebugModeChanged.fire({ sessionId, enabled });
      return;
    }
    agent.setDebugMode(enabled);
    const prefs = this.modePreferences.get(sessionId) ?? {};
    prefs.debugEnabled = enabled;
    this.modePreferences.set(sessionId, prefs);
    this._onDebugModeChanged.fire({ sessionId, enabled });

    // Start/stop a short-interval poller that watches for goal capture.
    // The agent sets `_debugGoal` lazily in the UserPromptSubmit hook;
    // polling lets us emit a one-shot `sessionGoalCaptured` event without
    // coupling the agent to the event bus.
    if (enabled) {
      this.startGoalPoller(sessionId);
    } else {
      this.stopGoalPoller(sessionId);
      this.sessionGoals.delete(sessionId);
    }
  }

  /** @internal */
  private startGoalPoller(sessionId: string): void {
    this.stopGoalPoller(sessionId);
    const tick = (): void => {
      const agent = this.activeSessions.get(sessionId);
      if (!agent) {
        this.stopGoalPoller(sessionId);
        return;
      }
      const goal = agent.getDebugGoal();
      if (goal && this.sessionGoals.get(sessionId) !== goal) {
        this.sessionGoals.set(sessionId, goal);
        this._onSessionGoalCaptured.fire({
          sessionId,
          goal,
          capturedAt: Date.now(),
        });
        // Goal captured — no need to keep polling.
        this.stopGoalPoller(sessionId);
      }
    };
    const handle = setInterval(tick, 500);
    this.goalPollers.set(sessionId, handle);
  }

  /** @internal */
  private stopGoalPoller(sessionId: string): void {
    const handle = this.goalPollers.get(sessionId);
    if (handle) {
      clearInterval(handle);
      this.goalPollers.delete(sessionId);
    }
  }

  /** Get Debug mode for a session. */
  getDebugMode(sessionId: string): boolean {
    const agent = this.activeSessions.get(sessionId);
    if (agent === undefined) {
      const prefs = this.modePreferences.get(sessionId);
      return prefs?.debugEnabled ?? false;
    }
    return agent.getDebugMode();
  }

  /**
   * Set tool permission policy for a session.
   * - 'approve-all': auto-approve everything (sets accept mode)
   * - 'smart': auto-approve read-only tools, prompt for writes
   * - 'ask-all': prompt for every tool (default)
   */
  setToolPolicy(sessionId: string, mode: string, _isWorktreeSession: boolean): void {
    const agent = this.activeSessions.get(sessionId);

    if (mode === 'approve-all') {
      // Delegate to accept mode — auto-approves everything
      this.setAcceptMode(sessionId, true);
      return;
    }

    // For 'ask-all' or unknown modes, ensure accept mode is off
    if (agent) {
      agent.setAcceptMode(false);
    }

    if (mode === 'smart' && agent) {
      // Pre-populate always-allowed list with read-only tools
      const readOnlyTools = [
        'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch',
        'Task', 'TodoRead', 'TodoWrite',
      ];
      const pm = agent.getPermissionManager();
      for (const tool of readOnlyTools) {
        pm.addAlwaysAllowed(tool);
      }
    }
  }

  /**
   * Dispose the session manager
   */
  override dispose(): void {
    // Deny all pending permission requests
    for (const [, resolver] of this.permissionResolvers.entries()) {
      resolver({ decision: 'deny', always: false });
    }
    this.permissionResolvers.clear();

    // Cancel all background consumers
    for (const [, consumer] of this.sessionConsumers.entries()) {
      consumer.cancel();
    }
    this.sessionConsumers.clear();

    // Stop all active sessions
    for (const [sessionId, agent] of this.activeSessions.entries()) {
      void agent.stopSession().catch((err: unknown) => {
        logger.error({ sessionId, error: err }, 'Error stopping session');
      });
    }
    this.activeSessions.clear();
    this.sessionToolUseMaps.clear();

    super.dispose();
  }
}
