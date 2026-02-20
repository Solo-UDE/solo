/**
 * Session Manager for Orbit Editor Agent Bridge
 * Manages Claude Agent SDK sessions and message streaming
 *
 * Enhanced with:
 * - Verbose SDK event logging (all stream_event subtypes)
 * - Tool timing (start/end duration measurement)
 * - Per-session cumulative token tracking
 * - Correlation IDs per sendMessage() call
 * - Debug event emitter for IPC to frontend debug panel
 */

import { randomUUID } from 'node:crypto';

import { OrbitAgent } from './agent.js';
import { Disposable, Emitter } from './events.js';
import { createLogger, setCorrelationId } from './logger.js';

import type { OrbitAgentConfig } from './agent.js';
import type { AttachmentContentBlock } from './messages.js';

const logger = createLogger('SessionManager');

// =============================================================================
// Debug Event Types
// =============================================================================

export type DebugEventCategory =
  | 'streaming'
  | 'tool'
  | 'token'
  | 'sdk_state'
  | 'permission'
  | 'compaction'
  | 'subagent'
  | 'hook'
  | 'session';

export interface DebugEvent {
  category: DebugEventCategory;
  name: string;
  data: unknown;
  correlationId?: string;
  timestamp: string;
  durationMs?: number;
}

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
  model?: 'haiku' | 'sonnet' | 'opus';
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
 * Cumulative token usage per session
 */
interface SessionTokenAccumulator {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  turnCount: number;
  totalCostUsd: number;
}

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
    new Emitter<{ sessionId: string; enabled: boolean }>()
  );
  readonly onPlanModeChanged = this._onPlanModeChanged.event;

  private readonly _onAcceptModeChanged = this._register(
    new Emitter<{ sessionId: string; enabled: boolean }>()
  );
  readonly onAcceptModeChanged = this._onAcceptModeChanged.event;

  private readonly _onSessionInit = this._register(new Emitter<SessionInitEvent>());
  readonly onSessionInit = this._onSessionInit.event;

  /** Debug event emitter — routes structured events to IPC for the debug panel */
  private readonly _onDebugEvent = this._register(
    new Emitter<{ sessionId: string; event: DebugEvent }>()
  );
  readonly onDebugEvent = this._onDebugEvent.event;

  // Session tracking
  private activeSessions = new Map<string, OrbitAgent>();
  private sessionConsumers = new Map<string, { cancel: () => void }>();
  private permissionResolvers = new Map<string, PermissionResolver>();
  private modePreferences = new Map<
    string,
    {
      thinkingEnabled?: boolean;
      maxThinkingTokens?: number;
      planEnabled?: boolean;
      acceptEnabled?: boolean;
      critiqueEnabled?: boolean;
      model?: 'haiku' | 'sonnet' | 'opus';
    }
  >();
  private pendingTools = new Map<
    string,
    Map<string, { toolName: string; toolId: string; toolInput: Record<string, unknown> }>
  >();
  private approvedToolNames = new Map<string, Set<string>>();
  private sessionResumeState = new Map<string, { isResumed: boolean; isForked: boolean }>();
  private sessionInitFired = new Set<string>();

  // Debug tracking
  private sessionTokenAccum = new Map<string, SessionTokenAccumulator>();
  private toolStartTimes = new Map<string, number>(); // toolUseId → Date.now()
  private sessionCorrelationIds = new Map<string, string>(); // sessionId → current correlationId

  // ==========================================================================
  // Debug Helpers
  // ==========================================================================

  private emitDebug(sessionId: string, category: DebugEventCategory, name: string, data: unknown, durationMs?: number): void {
    const correlationId = this.sessionCorrelationIds.get(sessionId);
    const event: DebugEvent = {
      category,
      name,
      data,
      correlationId,
      timestamp: new Date().toISOString(),
      durationMs,
    };
    this._onDebugEvent.fire({ sessionId, event });
  }

  private getOrCreateTokenAccum(sessionId: string): SessionTokenAccumulator {
    let accum = this.sessionTokenAccum.get(sessionId);
    if (!accum) {
      accum = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        turnCount: 0,
        totalCostUsd: 0,
      };
      this.sessionTokenAccum.set(sessionId, accum);
    }
    return accum;
  }

  // ==========================================================================
  // Session Lifecycle
  // ==========================================================================

  /**
   * Create a new agent session
   */
  createSession(sessionId: string, config?: SessionConfig): void {
    if (this.activeSessions.has(sessionId)) {
      return;
    }

    // Initialize tracking maps
    this.pendingTools.set(sessionId, new Map());
    this.approvedToolNames.set(sessionId, new Set());

    // Create permission callback that fires events
    const permissionCallback = async (
      toolName: string,
      toolInput: Record<string, unknown>,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      context: { signal: AbortSignal; suggestions?: unknown[] }
    ): Promise<{
      decision: 'approve' | 'deny';
      always: boolean;
      answers?: Record<string, string>;
    }> => {
      const requestId = randomUUID();

      this.emitDebug(sessionId, 'permission', 'permission_requested', {
        toolName,
        toolInput: Object.keys(toolInput),
        requestId,
      });

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

      this.emitDebug(sessionId, 'permission', 'permission_resolved', {
        toolName,
        decision: result.decision,
        always: result.always,
        requestId,
      });

      // If approved, track for race condition handling
      if (result.decision === 'approve') {
        if (toolName === 'ExitPlanMode') {
          agent.setPlanMode(false);
          const prefs = this.modePreferences.get(sessionId) ?? {};
          prefs.planEnabled = false;
          this.modePreferences.set(sessionId, prefs);
        }

        const approvedTools = this.approvedToolNames.get(sessionId);
        if (approvedTools !== undefined) {
          approvedTools.add(toolName);
        }

        // Update pending tools status
        const sessionPendingTools = this.pendingTools.get(sessionId);
        if (sessionPendingTools !== undefined) {
          for (const tool of sessionPendingTools.values()) {
            if (tool.toolName === toolName) {
              this._onAgentMessage.fire({
                sessionId,
                message: {
                  type: 'tool_use',
                  content: `Tool ${toolName} running`,
                  metadata: {
                    toolName: tool.toolName,
                    toolId: tool.toolId,
                    toolInput: tool.toolInput,
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
      critiqueEnabled: storedPrefs?.critiqueEnabled ?? config?.critiqueEnabled ?? false,
      model: storedPrefs?.model ?? config?.model,
      cwd: config?.cwd,
      sessionMode: config?.sessionMode ?? 'agent',
      permissionRequestCallback: permissionCallback,
      resumeSessionId: config?.resumeSessionId,
      forkSession: config?.forkSession,
    };

    logger.info({ sessionId, sessionMode: finalConfig.sessionMode }, 'Creating session');

    // Log full config for debug (omit credentials)
    this.emitDebug(sessionId, 'session', 'session_creating', {
      model: finalConfig.model ?? 'sonnet',
      thinkingEnabled: finalConfig.thinkingEnabled,
      maxThinkingTokens: finalConfig.maxThinkingTokens,
      planEnabled: finalConfig.planEnabled,
      acceptEnabled: finalConfig.acceptEnabled,
      critiqueEnabled: finalConfig.critiqueEnabled,
      sessionMode: finalConfig.sessionMode,
      cwd: finalConfig.cwd,
      hasResumeId: !!finalConfig.resumeSessionId,
      forkSession: finalConfig.forkSession,
    });

    const agent = new OrbitAgent(finalConfig);

    // Track resume/fork state
    this.sessionResumeState.set(sessionId, {
      isResumed: !!config?.resumeSessionId,
      isForked: !!config?.forkSession,
    });

    this.activeSessions.set(sessionId, agent);

    try {
      agent.startSession();
      logger.info({ sessionId }, 'Session started successfully');
      this.emitDebug(sessionId, 'session', 'session_started', { sessionId });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ sessionId, error: errorMessage }, 'Failed to start session');
      this.emitDebug(sessionId, 'session', 'session_start_failed', { error: errorMessage });
      throw error;
    }

    // Start background consumer for real-time streaming
    this._startBackgroundConsumer(sessionId, agent);
  }

  /**
   * Start a background consumer for streaming messages.
   * Logs ALL SDK event types for full observability.
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
        const toolUseMap = new Map<
          string,
          { name: string; input: Record<string, unknown>; pendingMessages: AgentMessage[] }
        >();

        // Streaming stats for debug
        let streamBlockCount = 0;
        let streamCharCount = 0;

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
            this.emitDebug(sessionId, 'sdk_state', 'system_message', {
              subtype: sdkMessage.subtype,
              sessionId: sdkMessage.session_id,
            });

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
          // stream_event — log ALL subtypes
          // =================================================================
          if (sdkMessage.type === 'stream_event') {
            const event = sdkMessage.event;
            if (event === undefined) continue;

            // Verbose logging of every stream event type
            switch (event.type) {
              case 'message_start':
                logger.debug({ sessionId }, 'stream: message_start');
                this.emitDebug(sessionId, 'streaming', 'message_start', {});
                streamBlockCount = 0;
                streamCharCount = 0;
                break;

              case 'content_block_start':
                streamBlockCount++;
                logger.debug(
                  { sessionId, blockIndex: event.index, blockType: event.content_block?.type },
                  'stream: content_block_start'
                );
                this.emitDebug(sessionId, 'streaming', 'content_block_start', {
                  blockIndex: event.index,
                  blockType: event.content_block?.type,
                });
                break;

              case 'content_block_delta': {
                const deltaType = event.delta?.type;

                if (deltaType === 'text_delta') {
                  const textDelta = event.delta?.text;
                  if (textDelta !== undefined) {
                    streamCharCount += textDelta.length;
                    this._onAgentMessage.fire({
                      sessionId,
                      message: { type: 'text', content: textDelta },
                    });
                  }
                } else if (deltaType === 'thinking_delta') {
                  const thinkingDelta = event.delta?.thinking;
                  if (thinkingDelta !== undefined) {
                    streamCharCount += thinkingDelta.length;
                    this._onAgentMessage.fire({
                      sessionId,
                      message: { type: 'thinking', content: thinkingDelta },
                    });
                  }
                } else {
                  // Log any other delta types we haven't seen before
                  logger.debug(
                    { sessionId, deltaType, blockIndex: event.index },
                    'stream: unknown delta type'
                  );
                  this.emitDebug(sessionId, 'streaming', 'unknown_delta', {
                    deltaType,
                    blockIndex: event.index,
                  });
                }
                break;
              }

              case 'content_block_stop':
                logger.debug(
                  { sessionId, blockIndex: event.index },
                  'stream: content_block_stop'
                );
                this.emitDebug(sessionId, 'streaming', 'content_block_stop', {
                  blockIndex: event.index,
                });
                break;

              case 'message_delta':
                logger.debug({ sessionId }, 'stream: message_delta');
                this.emitDebug(sessionId, 'streaming', 'message_delta', {
                  delta: event.delta,
                });
                break;

              case 'message_stop':
                logger.debug(
                  { sessionId, blockCount: streamBlockCount, charCount: streamCharCount },
                  'stream: message_stop'
                );
                this.emitDebug(sessionId, 'streaming', 'message_stop', {
                  totalBlocks: streamBlockCount,
                  totalChars: streamCharCount,
                });
                break;

              default:
                logger.debug(
                  { sessionId, eventType: event.type },
                  'stream: unhandled event type'
                );
                this.emitDebug(sessionId, 'streaming', `unhandled_${event.type}`, {
                  eventType: event.type,
                });
            }
            continue;
          }

          // =================================================================
          // assistant messages
          // =================================================================
          if (sdkMessage.type === 'assistant') {
            const content = sdkMessage.message?.content;
            if (content === undefined) continue;

            logger.debug(
              { sessionId, blockCount: content.length },
              'SDK assistant message'
            );

            for (const block of content) {
              // Skip text blocks (already streamed)
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

              // Record tool start time for duration tracking
              this.toolStartTimes.set(toolId, Date.now());

              logger.info(
                { sessionId, toolName, toolId },
                'Tool use block received'
              );
              this.emitDebug(sessionId, 'tool', 'tool_use_start', {
                toolName,
                toolId,
                inputKeys: Object.keys(toolInput),
                inputPreview: JSON.stringify(toolInput).slice(0, 200),
              });

              const approvedTools = this.approvedToolNames.get(sessionId);
              const wasAlreadyApproved = approvedTools?.has(toolName) ?? false;

              if (wasAlreadyApproved && approvedTools !== undefined) {
                approvedTools.delete(toolName);
              }

              const initialStatus = wasAlreadyApproved ? 'running' : 'awaiting-permission';

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

              toolUseMap.set(toolId, {
                name: toolName,
                input: toolInput,
                pendingMessages: [toolMessage],
              });

              if (!wasAlreadyApproved) {
                const sessionPendingTools = this.pendingTools.get(sessionId);
                if (sessionPendingTools !== undefined) {
                  sessionPendingTools.set(toolId, {
                    toolName,
                    toolId,
                    toolInput,
                  });
                }
              }

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

                // Compute tool duration
                const startTime = this.toolStartTimes.get(toolUseId);
                const durationMs = startTime !== undefined ? Date.now() - startTime : undefined;
                this.toolStartTimes.delete(toolUseId);

                if (toolInfo !== undefined) {
                  const originalMessage = toolInfo.pendingMessages[0];
                  if (
                    originalMessage.type === 'tool_use' &&
                    originalMessage.metadata !== undefined
                  ) {
                    const toolOutput =
                      typeof block.content === 'string'
                        ? block.content
                        : JSON.stringify(block.content);
                    const isError = block.is_error === true;
                    const storedToolId = originalMessage.metadata.toolId;

                    logger.info(
                      {
                        sessionId,
                        toolName: toolInfo.name,
                        toolId: storedToolId,
                        isError,
                        durationMs,
                        outputLength: toolOutput.length,
                      },
                      'Tool result received'
                    );
                    this.emitDebug(sessionId, 'tool', 'tool_use_end', {
                      toolName: toolInfo.name,
                      toolId: storedToolId,
                      isError,
                      outputPreview: toolOutput.slice(0, 500),
                      outputLength: toolOutput.length,
                      durationMs,
                    });

                    const completedMessage: AgentMessage = {
                      type: 'tool_use',
                      content: isError
                        ? `Tool ${toolInfo.name} failed`
                        : `Tool ${toolInfo.name} completed`,
                      metadata: {
                        toolName: toolInfo.name,
                        toolId: storedToolId,
                        toolInput: toolInfo.input,
                        toolOutput,
                        status: isError ? 'error' : 'success',
                      },
                    };

                    this._onAgentMessage.fire({ sessionId, message: completedMessage });

                    const sessionPendingTools = this.pendingTools.get(sessionId);
                    if (sessionPendingTools !== undefined && storedToolId !== undefined) {
                      sessionPendingTools.delete(storedToolId);
                    }
                  }

                  toolUseMap.delete(toolUseId);
                }
              }
            }
          } else {
            // =================================================================
            // result messages — accumulate tokens
            // =================================================================
            const resultMsg = sdkMessage;

            // Accumulate token usage
            if (resultMsg.usage !== undefined) {
              const accum = this.getOrCreateTokenAccum(sessionId);
              accum.inputTokens += resultMsg.usage.input_tokens ?? 0;
              accum.outputTokens += resultMsg.usage.output_tokens ?? 0;
              accum.cacheReadInputTokens += resultMsg.usage.cache_read_input_tokens ?? 0;
              accum.cacheCreationInputTokens += resultMsg.usage.cache_creation_input_tokens ?? 0;
              accum.turnCount++;
              accum.totalCostUsd += resultMsg.total_cost_usd ?? 0;

              logger.info(
                {
                  sessionId,
                  turnTokens: {
                    input: resultMsg.usage.input_tokens,
                    output: resultMsg.usage.output_tokens,
                    cacheRead: resultMsg.usage.cache_read_input_tokens,
                  },
                  cumulativeTokens: {
                    input: accum.inputTokens,
                    output: accum.outputTokens,
                    turns: accum.turnCount,
                    cost: accum.totalCostUsd.toFixed(4),
                  },
                },
                'Turn complete — token usage'
              );

              this.emitDebug(sessionId, 'token', 'turn_tokens', {
                turn: {
                  inputTokens: resultMsg.usage.input_tokens ?? 0,
                  outputTokens: resultMsg.usage.output_tokens ?? 0,
                  cacheReadInputTokens: resultMsg.usage.cache_read_input_tokens ?? 0,
                  cacheCreationInputTokens: resultMsg.usage.cache_creation_input_tokens ?? 0,
                  costUsd: resultMsg.total_cost_usd,
                  durationMs: resultMsg.duration_ms,
                },
                cumulative: { ...accum },
              });
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

            // Clear correlation ID after turn completes
            this.sessionCorrelationIds.delete(sessionId);
            setCorrelationId(undefined);
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : 'no stack';
        logger.error({ sessionId, error: errorMessage }, 'Background consumer error');
        this.emitDebug(sessionId, 'sdk_state', 'consumer_error', { error: errorMessage });
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

    this.pendingTools.delete(sessionId);
    this.approvedToolNames.delete(sessionId);
    this.sessionResumeState.delete(sessionId);
    this.sessionInitFired.delete(sessionId);
    this.sessionTokenAccum.delete(sessionId);
    this.sessionCorrelationIds.delete(sessionId);

    this.emitDebug(sessionId, 'session', 'session_deleted', { sessionId });
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
    this.emitDebug(sessionId, 'sdk_state', 'interrupt_requested', {});
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

    // Generate correlation ID for this message and all its related events
    const correlationId = randomUUID();
    this.sessionCorrelationIds.set(sessionId, correlationId);
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

    this.emitDebug(sessionId, 'session', 'message_sent', {
      correlationId,
      messageLength: message.length,
      messagePreview: message.slice(0, 100),
      attachmentCount: attachments?.length ?? 0,
    });

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
  async setModel(sessionId: string, model: 'haiku' | 'sonnet' | 'opus'): Promise<void> {
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
   * Set plan mode for a session
   */
  setPlanMode(sessionId: string, enabled: boolean): void {
    const agent = this.activeSessions.get(sessionId);
    if (agent === undefined) {
      const prefs = this.modePreferences.get(sessionId) ?? {};
      prefs.planEnabled = enabled;
      this.modePreferences.set(sessionId, prefs);
      this._onPlanModeChanged.fire({ sessionId, enabled });
      return;
    }
    agent.setPlanMode(enabled);
    const prefs = this.modePreferences.get(sessionId) ?? {};
    prefs.planEnabled = enabled;
    this.modePreferences.set(sessionId, prefs);
    this._onPlanModeChanged.fire({ sessionId, enabled });
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
    this.sessionTokenAccum.clear();
    this.toolStartTimes.clear();
    this.sessionCorrelationIds.clear();

    super.dispose();
  }
}
