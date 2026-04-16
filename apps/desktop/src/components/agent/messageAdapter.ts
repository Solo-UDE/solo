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
  | { type: 'thinking'; content: string; durationMs?: number; isStreaming?: boolean }
  | {
      type: 'toolCall';
      id: string;
      toolName: string;
      toolInput: Record<string, unknown>;
      status: 'running' | 'success' | 'error';
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
  // Find the last assistant message index for MessageActions rendering
  let lastAssistantIdx = -1;
  for (let i = storeMessages.length - 1; i >= 0; i--) {
    if (storeMessages[i].role === 'assistant') {
      lastAssistantIdx = i;
      break;
    }
  }

  return storeMessages.map((msg, index) => {
    const isLastAssistant = index === lastAssistantIdx;
    const orbitMessage: OrbitMessage = msg.role === 'user'
      ? {
          id: msg.id,
          type: 'user',
          content: msg.content,
          timestamp: msg.timestamp,
          attachments: msg.attachments,
          mentions: msg.mentions,
          skills: msg.skills,
          parts: msg.parts,
        }
      : {
          id: msg.id,
          type: 'agent',
          content: convertToAgentContent(msg, isLastAssistant),
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
function convertBlocksToRenderBlocks(
  blocks: ContentBlock[],
  msg: StoreMessage
): RenderBlock[] {
  const result: RenderBlock[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        result.push({ type: 'narrative', content: block.text });
        break;
      case 'thinking':
        result.push({
          type: 'thinking',
          content: block.text,
          durationMs: msg.thinkingDurationMs,
          isStreaming: msg.isStreaming,
        });
        break;
      case 'tool_use': {
        // Resolve tool call from the single source of truth (msg.toolCalls[index])
        const tc = msg.toolCalls?.[block.toolCallIndex];
        if (!tc) break;
        console.log('[DIAG] tool_use block', tc.name, tc.status, 'requestId:', tc.requestId);
        if (tc.status === 'awaiting-permission') {
          console.log('[DIAG] → rendering as approval', tc.requestId || tc.id);
          result.push({
            type: 'approval',
            requestId: tc.requestId || tc.id,
            toolName: tc.name,
            toolInput: tc.input,
          });
        } else {
          const toolInput = (typeof tc.input === 'object' && tc.input !== null)
            ? tc.input as Record<string, unknown>
            : {};
          result.push({
            type: 'toolCall',
            id: tc.id,
            toolName: tc.name,
            toolInput,
            status: tc.status as 'running' | 'success' | 'error',
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
function convertToAgentContent(msg: StoreMessage, isLastAssistant: boolean = false): AgentMessageContent {
  const content: AgentMessageContent = {
    narrative: msg.content,
    isStreaming: msg.isStreaming,
    isInterrupted: msg.isInterrupted,
    isLastAssistantMessage: isLastAssistant,
  };

  // If we have ordered blocks, use them for interleaved rendering
  if (msg.blocks && msg.blocks.length > 0) {
    content.blocks = convertBlocksToRenderBlocks(msg.blocks, msg);
  }

  // Pass turn number if available
  if (msg.turnNumber !== undefined) {
    content.turnNumber = msg.turnNumber;
  }

  // Also keep flat arrays as fallback for backward compat
  if (msg.toolCalls && msg.toolCalls.length > 0) {
    const regularCalls = msg.toolCalls.filter((tc) => tc.status !== 'awaiting-permission');
    const pendingCalls = msg.toolCalls.filter((tc) => tc.status === 'awaiting-permission');

    if (regularCalls.length > 0) {
      content.toolCalls = regularCalls.map((tc) => ({
        id: tc.id,
        toolName: tc.name,
        toolInput: (typeof tc.input === 'object' && tc.input !== null)
          ? tc.input as Record<string, unknown>
          : {},
        status: tc.status as 'running' | 'success' | 'error',
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
