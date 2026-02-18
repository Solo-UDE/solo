/**
 * CodingAgent — The core agentic loop running on the server.
 *
 * Uses Vercel AI SDK's `streamText` with tools for multi-turn
 * tool-using agent behavior. Events are emitted via AgentMux
 * and forwarded to the desktop over WebSocket.
 */

import { streamText, stepCountIs, type ModelMessage } from 'ai';
import { AgentMux } from '../../lib/mux';
import { resolveModel } from '../../lib/model-mapping';
import { createToolRegistry } from './tools';
import { buildSystemPrompt } from './prompts/system';
import type { DesktopClient } from '../../infrastructure/desktop/client';
import type { AgentRequest, AgentMessage, ContentBlock } from '../../types/websocket';

const MAX_STEPS = 25;

export interface ProcessRequestOptions {
  request: AgentRequest;
  desktopClient: DesktopClient;
  abortSignal?: AbortSignal;
  /** Callback to request tool approval from the desktop user */
  requestApproval: (toolCallId: string, name: string, args: string) => Promise<boolean>;
}

export class CodingAgent {
  private mux: AgentMux;

  constructor() {
    this.mux = new AgentMux();
  }

  getMux(): AgentMux {
    return this.mux;
  }

  async processRequest(opts: ProcessRequestOptions): Promise<void> {
    const { request, desktopClient, abortSignal, requestApproval } = opts;
    const conversationId = request.sessionId;

    // Resolve the model
    const model = resolveModel(request.model);

    // Create tool registry
    const tools = createToolRegistry(desktopClient, this.mux, conversationId, requestApproval);

    // Build conversation messages
    const messages: ModelMessage[] = [];

    // Add chat history
    if (request.chatHistory) {
      for (const msg of request.chatHistory) {
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        });
      }
    }

    // Add current user message
    messages.push({
      role: 'user',
      content: request.prompt,
    });

    // Build system prompt
    const systemPrompt = buildSystemPrompt({
      workspaceRoot: request.workspaceRoot,
      model: request.model,
    });

    let turnNumber = 0;

    try {
      // Emit turn start for the first turn
      turnNumber = 1;
      await this.mux.put({
        type: 'agent:turn_start',
        conversation_id: conversationId,
        turn_number: turnNumber,
      });

      const result = streamText({
        model,
        system: systemPrompt,
        messages,
        tools,
        maxOutputTokens: 16384,
        stopWhen: stepCountIs(MAX_STEPS),
        abortSignal,
        onStepFinish: async (step) => {
          // Each step = one LLM turn. If it ended with tool calls,
          // there'll be another step. Emit turn boundaries.
          if (step.toolCalls && step.toolCalls.length > 0) {
            // Build a complete message for this turn
            const contentBlocks: ContentBlock[] = [];
            if (step.text) {
              contentBlocks.push({ type: 'text', text: step.text });
            }

            const agentMessage: AgentMessage = {
              role: 'assistant',
              content: contentBlocks,
              text: step.text || undefined,
            };

            await this.mux.put({
              type: 'agent:complete',
              conversation_id: conversationId,
              message: agentMessage,
            });

            // Emit next turn start
            turnNumber++;
            await this.mux.put({
              type: 'agent:turn_start',
              conversation_id: conversationId,
              turn_number: turnNumber,
            });
          }
        },
      });

      // Stream text chunks to the frontend
      let accumulatedText = '';
      for await (const delta of result.textStream) {
        accumulatedText += delta;
        await this.mux.put({
          type: 'agent:chunk',
          conversation_id: conversationId,
          content: delta,
        });
      }

      // Final completion event
      const finalContentBlocks: ContentBlock[] = [];
      if (accumulatedText) {
        finalContentBlocks.push({ type: 'text', text: accumulatedText });
      }

      const finalMessage: AgentMessage = {
        role: 'assistant',
        content: finalContentBlocks,
        text: accumulatedText || undefined,
      };

      await this.mux.put({
        type: 'agent:complete',
        conversation_id: conversationId,
        message: finalMessage,
      });

      // Loop complete
      await this.mux.put({
        type: 'agent:loop_complete',
        conversation_id: conversationId,
        total_turns: turnNumber,
      });
    } catch (error) {
      if (abortSignal?.aborted) {
        await this.mux.put({
          type: 'agent:aborted',
          conversation_id: conversationId,
          reason: 'User cancelled the request',
        });
        return;
      }

      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[CodingAgent] Error:`, errorMsg);

      await this.mux.put({
        type: 'agent:error',
        conversation_id: conversationId,
        error: errorMsg,
      });
    }
  }

  cleanup(): void {
    this.mux.clear();
  }
}
