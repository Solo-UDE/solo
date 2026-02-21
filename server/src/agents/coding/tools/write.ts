import { tool } from 'ai';
import { z } from 'zod';
import type { DesktopClient } from '../../../infrastructure/desktop/client';
import type { AgentMux } from '../../../lib/mux';

const writeParams = z.object({
  path: z.string().describe('The file path to write to'),
  content: z.string().describe('The content to write to the file'),
});

export const createWriteTool = (
  desktopClient: DesktopClient,
  mux: AgentMux,
  conversationId: string,
  requestApproval: (toolCallId: string, name: string, args: string) => Promise<boolean>,
) =>
  tool({
    description:
      'Create a new file or overwrite an existing file with the provided content. Use this for creating brand new source files. Prefer the edit tool for targeted changes to existing files — only use write when you need to create a file from scratch or completely replace all content.',
    inputSchema: writeParams,
    execute: async (args: z.infer<typeof writeParams>) => {
      const { path, content } = args;
      const toolCallId = `write_${Date.now()}`;
      const displayArgs = JSON.stringify({ path, content: content.slice(0, 200) + (content.length > 200 ? '...' : '') });

      await mux.put({
        type: 'agent:tool_start',
        conversation_id: conversationId,
        tool_call: { id: toolCallId, name: 'write', arguments: displayArgs },
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
