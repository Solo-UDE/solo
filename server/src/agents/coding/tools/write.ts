import { tool } from 'ai';
import { z } from 'zod';
import type { DesktopClient } from '../../../infrastructure/desktop/client';
import type { AgentMux } from '../../../lib/mux';

export const createWriteTool = (
  desktopClient: DesktopClient,
  mux: AgentMux,
  conversationId: string,
  requestApproval: (toolCallId: string, name: string, args: string) => Promise<boolean>,
) =>
  tool({
    description:
      'Write content to a file. Creates the file if it does not exist, or overwrites it if it does. Use this for creating new files or completely replacing file contents.',
    parameters: z.object({
      path: z.string().describe('The file path to write to'),
      content: z.string().describe('The content to write to the file'),
    }),
    execute: async ({ path, content }) => {
      const toolCallId = `write_${Date.now()}`;
      const args = JSON.stringify({ path, content: content.slice(0, 200) + (content.length > 200 ? '...' : '') });

      await mux.put({
        type: 'agent:tool_start',
        conversation_id: conversationId,
        tool_call: { id: toolCallId, name: 'write', arguments: args },
      });

      // Request approval for write operations
      const approved = await requestApproval(toolCallId, 'write', JSON.stringify({ path, content }));
      if (!approved) {
        const result = 'Tool call rejected by user.';
        await mux.put({ type: 'agent:tool_end', conversation_id: conversationId, tool_call_id: toolCallId, result });
        return result;
      }

      try {
        await desktopClient.writeFile(path, content);
        const result = `Successfully wrote ${content.length} bytes to ${path}`;
        await mux.put({ type: 'agent:tool_end', conversation_id: conversationId, tool_call_id: toolCallId, result });
        return result;
      } catch (error) {
        const result = `Error writing file: ${error instanceof Error ? error.message : String(error)}`;
        await mux.put({ type: 'agent:tool_end', conversation_id: conversationId, tool_call_id: toolCallId, result });
        return result;
      }
    },
  });
