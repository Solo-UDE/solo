/**
 * WebSocket message types for Solo server <-> desktop communication.
 *
 * Client = Desktop (Tauri), Server = Solo Server (Hono+Bun)
 */

import type { AgentToolCall, ToolCallWithStatus } from './agent';

// =============================================================================
// Agent Request (sent from desktop with user's prompt)
// =============================================================================

export interface AgentRequest {
  sessionId: string;
  prompt: string;
  model: string;
  mode: 'planning' | 'fast';
  workspaceRoot: string;
  chatHistory?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
}

// =============================================================================
// Client -> Server Messages
// =============================================================================

export type ClientMessage =
  | { type: 'user_request'; data: AgentRequest }
  | { type: 'cancel'; data?: { reason?: string } }
  | { type: 'fs_operation_response'; id: string; success: boolean; data?: any; error?: string }
  | { type: 'tool_approval_response'; toolCallId: string; approved: boolean };

// =============================================================================
// Server -> Client Messages
// =============================================================================

export type ServerMessage =
  | { type: 'connected'; message: string }
  | { type: 'init'; message: string }
  | { type: 'agent:chunk'; conversation_id: string; content: string }
  | { type: 'agent:turn_start'; conversation_id: string; turn_number: number }
  | { type: 'agent:tool_start'; conversation_id: string; tool_call: AgentToolCall }
  | { type: 'agent:tool_end'; conversation_id: string; tool_call_id: string; result: string }
  | { type: 'agent:tool_approval_needed'; conversation_id: string; tool_call: ToolCallWithStatus }
  | { type: 'agent:complete'; conversation_id: string; message: AgentMessage }
  | { type: 'agent:error'; conversation_id: string; error: string }
  | { type: 'agent:loop_complete'; conversation_id: string; total_turns: number }
  | { type: 'agent:aborted'; conversation_id: string; reason: string }
  | { type: 'fs_operation'; id: string; operation: FsOperationType; path?: string; content?: string; command?: string }
  | { type: 'complete'; data: string }
  | { type: 'error'; data: string }
  | { type: 'cancelled'; message: string };

// =============================================================================
// Agent message type (matches Solo protocol's AgentMessage)
// =============================================================================

export interface AgentMessage {
  role: string;
  content: ContentBlock[];
  text?: string;
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: any;
  tool_use_id?: string;
  content?: string;
}

// =============================================================================
// Filesystem operation types (server -> desktop)
// =============================================================================

export type FsOperationType =
  | 'read'
  | 'write'
  | 'delete'
  | 'list'
  | 'run_command'
  | 'ripgrep'
  | 'glob';

// =============================================================================
// Helpers
// =============================================================================

export function parseClientMessage(raw: string): ClientMessage {
  try {
    return JSON.parse(raw) as ClientMessage;
  } catch {
    throw new Error(`Invalid client message: ${raw.slice(0, 200)}`);
  }
}

export function createServerMessage(msg: ServerMessage): string {
  return JSON.stringify(msg);
}
