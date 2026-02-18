/**
 * Adapter utilities to convert between store messages and orbit-agent message format
 */

import type { Message as StoreMessage, ContentBlock } from '../../stores/agentStore';
import type {
  MessageGroup,
  Message as OrbitMessage,
  AgentMessageContent,
} from './messages';

/**
 * A single renderable block in an agent message (ordered).
 */
export type RenderBlock =
  | { type: 'narrative'; content: string }
  | { type: 'thinking'; content: string }
  | {
      type: 'toolCall';
      id: string;
      command: string;
      cwd: string;
      exitCode?: number;
      output?: string;
    }
  | {
      type: 'approval';
      requestId: string;
      toolName: string;
      toolInput: unknown;
    };

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
 * Convert ordered ContentBlock[] to RenderBlock[] for the component.
 */
function convertBlocksToRenderBlocks(blocks: ContentBlock[]): RenderBlock[] {
  const result: RenderBlock[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        result.push({ type: 'narrative', content: block.text });
        break;
      case 'thinking':
        result.push({ type: 'thinking', content: block.text });
        break;
      case 'tool_use': {
        const tc = block.toolCall;
        if (tc.status === 'awaiting-permission') {
          result.push({
            type: 'approval',
            requestId: tc.requestId || tc.id,
            toolName: tc.name,
            toolInput: tc.input,
          });
        } else {
          result.push({
            type: 'toolCall',
            id: tc.id,
            command: tc.name,
            cwd: '.',
            exitCode: tc.status === 'success' ? 0 : tc.status === 'error' ? 1 : undefined,
            output: tc.output,
          });
        }
        break;
      }
    }
  }

  return result;
}

/**
 * Convert store message to AgentMessageContent
 */
function convertToAgentContent(msg: StoreMessage): AgentMessageContent {
  const content: AgentMessageContent = {
    narrative: msg.content,
    isStreaming: msg.isStreaming,
  };

  // If we have ordered blocks, use them for interleaved rendering
  if (msg.blocks && msg.blocks.length > 0) {
    content.blocks = convertBlocksToRenderBlocks(msg.blocks);
  }

  // Also keep flat arrays as fallback for backward compat
  if (msg.toolCalls && msg.toolCalls.length > 0) {
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
