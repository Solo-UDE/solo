/**
 * Adapter utilities to convert between Athens store messages and orbit-agent message format
 */

import type { Message as StoreMessage } from '../../stores/agentStore';
import type {
  MessageGroup,
  Message as OrbitMessage,
  AgentMessageContent,
} from './messages';

/**
 * Convert Athens store Message[] to orbit-agent MessageGroup[]
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
          attachments: msg.attachments,
          mentions: msg.mentions,
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
  };

  // Convert tool calls if present
  if (msg.toolCalls && msg.toolCalls.length > 0) {
    // Separate pending approvals from regular tool calls
    const regularCalls = msg.toolCalls.filter((tc) => tc.status !== 'pending_approval');
    const pendingCalls = msg.toolCalls.filter((tc) => tc.status === 'pending_approval');

    if (regularCalls.length > 0) {
      content.toolCalls = regularCalls.map((tc) => ({
        id: tc.id,
        command: tc.name,
        cwd: '.',
        exitCode: tc.status === 'completed' ? 0 : tc.status === 'error' ? 1 : undefined,
        output: tc.result,
      }));
    }

    if (pendingCalls.length > 0) {
      content.pendingApprovals = pendingCalls.map((tc) => ({
        tool_call: {
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        },
        status: 'pending_approval' as const,
        result: null,
        error: null,
        needs_approval: true,
      }));
    }
  }

  return content;
}
