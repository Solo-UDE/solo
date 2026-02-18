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
 * Consecutive assistant messages are merged into a single group so they
 * render as one bubble with turn separators instead of separate bubbles.
 */
export function convertToMessageGroups(storeMessages: StoreMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];

  for (const msg of storeMessages) {
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
          turnNumber: msg.turnNumber,
        };

    // Merge consecutive assistant messages into the same group
    const lastGroup = groups[groups.length - 1];
    if (
      msg.role === 'assistant' &&
      lastGroup &&
      lastGroup.messages.length > 0 &&
      lastGroup.messages[lastGroup.messages.length - 1].type === 'agent'
    ) {
      lastGroup.messages.push(orbitMessage);
    } else {
      groups.push({
        id: `group-${groups.length}`,
        messages: [orbitMessage],
      });
    }
  }

  return groups;
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
    content.toolCalls = msg.toolCalls.map((tc) => ({
      id: tc.id,
      name: tc.name,
      arguments: tc.arguments,
      status: tc.status,
      result: tc.result,
    }));
  }

  return content;
}
