/**
 * Agent types — mirrors Solo protocol types exactly.
 */

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type ToolCallStatus =
  | 'Pending'
  | 'PendingApproval'
  | 'Running'
  | 'Completed'
  | 'Error';

export interface ToolCallWithStatus {
  tool_call: AgentToolCall;
  status: ToolCallStatus;
  result?: string;
  error?: string;
  needs_approval: boolean;
}
