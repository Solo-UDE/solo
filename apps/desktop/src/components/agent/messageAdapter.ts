/**
 * Adapter utilities to convert between store messages and orbit-agent message format
 */

import type { Message as StoreMessage } from '../../stores/agentStore';
import type {
  MessageGroup,
  Message as OrbitMessage,
  AgentMessageContent,
} from './messages';

/**
 * Convert store Message[] to orbit-agent MessageGroup[]
 * Each message becomes its own group for simplicity
 */
export function convertToMessageGroups(storeMessages: StoreMessage[]): MessageGroup[] {
  return storeMessages.map((msg, index) => {
    const orbitMessage: OrbitMessage = msg.role === 'user'
      ? {
          id: msg.id,
          type: 'user',
          content: msg.content,
          timestamp: msg.timestamp,
        }
      : {
          id: msg.id,
          type: 'agent',
          content: convertToAgentContent(msg),
          timestamp: msg.timestamp,
        };

    return {
      id: `group-${index}`,
      messages: [orbitMessage],
    };
  });
}

/**
 * Convert store message to AgentMessageContent
 */
function convertToAgentContent(msg: StoreMessage): AgentMessageContent {
  const content: AgentMessageContent = {
    narrative: msg.content,
    isStreaming: msg.isStreaming,
  };

  // Convert tool calls if present
  if (msg.toolCalls && msg.toolCalls.length > 0) {
    // Separate pending approvals from regular tool calls
    const regularCalls = msg.toolCalls.filter((tc) => tc.status !== 'awaiting-permission');
    const pendingCalls = msg.toolCalls.filter((tc) => tc.status === 'awaiting-permission');

    if (regularCalls.length > 0) {
      content.toolCalls = regularCalls.map((tc) => ({
        id: tc.id,
        command: tc.name,
        cwd: '.',
        exitCode: tc.status === 'success' ? 0 : tc.status === 'error' ? 1 : undefined,
        output: tc.output,
      }));
    }

    if (pendingCalls.length > 0) {
      content.pendingApprovals = pendingCalls.map((tc) => ({
        requestId: tc.requestId || tc.id,
        toolName: tc.name,
        toolInput: tc.input,
      }));
    }
  }

  return content;
}
