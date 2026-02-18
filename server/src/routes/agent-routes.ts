/**
 * Agent WebSocket route — handles bidirectional communication between
 * the Solo server and the desktop app.
 */

import { Hono } from 'hono';
import { createBunWebSocket } from 'hono/bun';
import { CodingAgent } from '../agents/coding/agent';
import { DesktopClient } from '../infrastructure/desktop/client';
import {
  parseClientMessage,
  createServerMessage,
  type AgentRequest,
} from '../types/websocket';
import type { ToolCallWithStatus } from '../types/agent';

const { upgradeWebSocket, websocket } = createBunWebSocket();

const agentRoutes = new Hono();

// Health check
agentRoutes.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'solo-agent-server',
    timestamp: new Date().toISOString(),
  });
});

// WebSocket route for coding agent
agentRoutes.get(
  '/ws/agent',
  upgradeWebSocket((c) => {
    // Per-connection state
    let currentAgent: CodingAgent | null = null;
    let currentUnsubscribe: (() => void) | null = null;
    let desktopClient: DesktopClient | null = null;
    let abortController: AbortController | null = null;
    let isProcessing = false;

    // Pending tool approval channels
    const pendingApprovals = new Map<
      string,
      { resolve: (approved: boolean) => void; timeout: ReturnType<typeof setTimeout> }
    >();

    return {
      onOpen: (_event, ws) => {
        ws.send(createServerMessage({ type: 'connected', message: 'Connected to Solo agent server' }));
      },

      onMessage: async (event, ws) => {
        try {
          const message = parseClientMessage(event.data.toString());

          // Handle fs_operation_response from desktop
          if (message.type === 'fs_operation_response') {
            if (desktopClient) {
              desktopClient.handleResponse(message.id, message.success, message.data, message.error);
            }
            return;
          }

          // Handle tool approval response from desktop
          if (message.type === 'tool_approval_response') {
            const pending = pendingApprovals.get(message.toolCallId);
            if (pending) {
              clearTimeout(pending.timeout);
              pendingApprovals.delete(message.toolCallId);
              pending.resolve(message.approved);
            }
            return;
          }

          switch (message.type) {
            case 'user_request': {
              if (isProcessing) {
                ws.send(createServerMessage({
                  type: 'error',
                  data: 'Agent is already processing a request. Send cancel first.',
                }));
                return;
              }

              isProcessing = true;
              const data = message.data as AgentRequest;

              // Create abort controller
              abortController = new AbortController();

              // Create desktop client for this connection
              desktopClient = new DesktopClient(ws, data.workspaceRoot);

              // Send init message
              ws.send(createServerMessage({ type: 'init', message: 'Starting agent...' }));

              // Create agent
              currentAgent = new CodingAgent();

              // Subscribe to mux events and forward to WebSocket
              const mux = currentAgent.getMux();
              currentUnsubscribe = mux.subscribe((agentEvent: any) => {
                try {
                  ws.send(JSON.stringify(agentEvent));
                } catch (sendError) {
                  console.error('Error sending event to WebSocket:', sendError);
                }
              });

              // Tool approval request handler
              const requestApproval = (toolCallId: string, name: string, args: string): Promise<boolean> => {
                return new Promise((resolve) => {
                  const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

                  const timeout = setTimeout(() => {
                    pendingApprovals.delete(toolCallId);
                    resolve(false); // Auto-reject on timeout
                  }, APPROVAL_TIMEOUT_MS);

                  pendingApprovals.set(toolCallId, { resolve, timeout });

                  // Emit approval needed event to desktop
                  const toolCallEvent: ToolCallWithStatus = {
                    tool_call: { id: toolCallId, name, arguments: args },
                    status: 'PendingApproval',
                    needs_approval: true,
                  };

                  ws.send(JSON.stringify({
                    type: 'agent:tool_approval_needed',
                    conversation_id: data.sessionId,
                    tool_call: toolCallEvent,
                  }));
                });
              };

              try {
                // Process the request
                await currentAgent.processRequest({
                  request: data,
                  desktopClient,
                  abortSignal: abortController.signal,
                  requestApproval,
                });

                // Send completion
                ws.send(createServerMessage({ type: 'complete', data: 'Agent processing complete' }));
              } catch (error) {
                if (!abortController.signal.aborted) {
                  console.error('Error in coding agent:', error);
                  ws.send(createServerMessage({
                    type: 'error',
                    data: error instanceof Error ? error.message : 'Unknown error',
                  }));
                }
              } finally {
                isProcessing = false;
                abortController = null;
              }

              break;
            }

            case 'cancel': {
              // Abort the ongoing request
              if (abortController) {
                abortController.abort();
                abortController = null;
              }

              // Clean up pending approvals
              for (const [, pending] of pendingApprovals) {
                clearTimeout(pending.timeout);
                pending.resolve(false);
              }
              pendingApprovals.clear();

              // Cleanup agent
              if (currentUnsubscribe) {
                currentUnsubscribe();
                currentUnsubscribe = null;
              }
              if (currentAgent) {
                currentAgent.cleanup();
                currentAgent = null;
              }
              if (desktopClient) {
                desktopClient.cleanup();
              }

              isProcessing = false;

              ws.send(createServerMessage({
                type: 'cancelled',
                message: 'Agent processing cancelled successfully',
              }));
              break;
            }

            default:
              ws.send(createServerMessage({
                type: 'error',
                data: `Unknown message type: ${(message as any).type}`,
              }));
          }
        } catch (error) {
          console.error('Error handling WebSocket message:', error);
          ws.send(createServerMessage({
            type: 'error',
            data: error instanceof Error ? error.message : 'Unknown error',
          }));
          isProcessing = false;
          abortController = null;
        }
      },

      onClose: () => {
        // Cleanup on disconnect
        if (abortController) {
          abortController.abort();
          abortController = null;
        }
        for (const [, pending] of pendingApprovals) {
          clearTimeout(pending.timeout);
          pending.resolve(false);
        }
        pendingApprovals.clear();
        if (currentUnsubscribe) {
          currentUnsubscribe();
        }
        if (currentAgent) {
          currentAgent.cleanup();
        }
        if (desktopClient) {
          desktopClient.cleanup();
        }
      },

      onError: (event) => {
        console.error('WebSocket error:', event);
      },
    };
  })
);

export default agentRoutes;
export { websocket };
