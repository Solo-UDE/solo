/**
 * IPC Protocol for Rust ↔ Node.js communication
 * Newline-delimited JSON messages over stdin/stdout
 */

import type { AttachmentContentBlock } from './messages.js';
import type {
  AgentMessage,
  PermissionRequest,
  PermissionResponse,
  SessionConfig,
  SessionInitEvent,
  SerializableError,
} from './session-manager.js';

// ============================================================================
// Request Types (Rust → Node.js)
// ============================================================================

/**
 * Create a new session
 */
export interface CreateSessionRequest {
  type: 'create_session';
  sessionId: string;
  config?: SessionConfig;
}

/**
 * Delete a session
 */
export interface DeleteSessionRequest {
  type: 'delete_session';
  sessionId: string;
}

/**
 * Send a message to a session
 */
export interface SendMessageRequest {
  type: 'send_message';
  sessionId: string;
  message: string;
  attachments?: AttachmentContentBlock[];
}

/**
 * Interrupt a session
 */
export interface InterruptRequest {
  type: 'interrupt';
  sessionId: string;
}

/**
 * Respond to a permission request
 */
export interface PermissionResponseRequest {
  type: 'permission_response';
  response: PermissionResponse;
}

/**
 * Set thinking mode
 */
export interface SetThinkingModeRequest {
  type: 'set_thinking_mode';
  sessionId: string;
  enabled: boolean;
  maxTokens?: number;
}

/**
 * Get thinking mode
 */
export interface GetThinkingModeRequest {
  type: 'get_thinking_mode';
  sessionId: string;
}

/**
 * Set model
 */
export interface SetModelRequest {
  type: 'set_model';
  sessionId: string;
  model: 'haiku' | 'sonnet' | 'opus';
}

/**
 * Set plan mode
 */
export interface SetPlanModeRequest {
  type: 'set_plan_mode';
  sessionId: string;
  enabled: boolean;
}

/**
 * Get plan mode
 */
export interface GetPlanModeRequest {
  type: 'get_plan_mode';
  sessionId: string;
}

/**
 * Set accept mode
 */
export interface SetAcceptModeRequest {
  type: 'set_accept_mode';
  sessionId: string;
  enabled: boolean;
}

/**
 * Get accept mode
 */
export interface GetAcceptModeRequest {
  type: 'get_accept_mode';
  sessionId: string;
}

/**
 * Check if session is ready
 */
export interface IsSessionReadyRequest {
  type: 'is_session_ready';
  sessionId: string;
}

/**
 * Get SDK session ID
 */
export interface GetSDKSessionIdRequest {
  type: 'get_sdk_session_id';
  sessionId: string;
}

/**
 * Shutdown the bridge
 */
export interface ShutdownRequest {
  type: 'shutdown';
}

/**
 * All possible requests from Rust
 */
export type BridgeRequest =
  | CreateSessionRequest
  | DeleteSessionRequest
  | SendMessageRequest
  | InterruptRequest
  | PermissionResponseRequest
  | SetThinkingModeRequest
  | GetThinkingModeRequest
  | SetModelRequest
  | SetPlanModeRequest
  | GetPlanModeRequest
  | SetAcceptModeRequest
  | GetAcceptModeRequest
  | IsSessionReadyRequest
  | GetSDKSessionIdRequest
  | ShutdownRequest;

// ============================================================================
// Response Types (Node.js → Rust)
// ============================================================================

/**
 * Success response for void operations
 */
export interface SuccessResponse {
  type: 'success';
  requestType: string;
}

/**
 * Error response
 */
export interface ErrorResponse {
  type: 'error';
  requestType: string;
  error: string;
}

/**
 * Boolean result response
 */
export interface BooleanResponse {
  type: 'boolean';
  requestType: string;
  value: boolean;
}

/**
 * String result response
 */
export interface StringResponse {
  type: 'string';
  requestType: string;
  value: string | null;
}

/**
 * All possible command responses
 */
export type CommandResponse = SuccessResponse | ErrorResponse | BooleanResponse | StringResponse;

// ============================================================================
// Event Types (Node.js → Rust, unsolicited)
// ============================================================================

/**
 * Agent message event
 */
export interface AgentMessageEvent {
  type: 'agent_message';
  sessionId: string;
  message: AgentMessage;
}

/**
 * Permission request event
 */
export interface PermissionRequestEvent {
  type: 'permission_request';
  request: PermissionRequest;
}

/**
 * Session init event
 */
export interface SessionInitEventMessage {
  type: 'session_init';
  event: SessionInitEvent;
}

/**
 * Plan mode changed event
 */
export interface PlanModeChangedEvent {
  type: 'plan_mode_changed';
  sessionId: string;
  enabled: boolean;
}

/**
 * Accept mode changed event
 */
export interface AcceptModeChangedEvent {
  type: 'accept_mode_changed';
  sessionId: string;
  enabled: boolean;
}

/**
 * Error event
 */
export interface ErrorEvent {
  type: 'error_event';
  error: SerializableError;
}

/**
 * Ready event (sent when bridge is initialized)
 */
export interface ReadyEvent {
  type: 'ready';
}

/**
 * All possible events from Node.js
 */
export type BridgeEvent =
  | AgentMessageEvent
  | PermissionRequestEvent
  | SessionInitEventMessage
  | PlanModeChangedEvent
  | AcceptModeChangedEvent
  | ErrorEvent
  | ReadyEvent;

/**
 * All possible messages from Node.js to Rust
 */
export type BridgeResponse = CommandResponse | BridgeEvent;
