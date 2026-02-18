import { tool } from 'ai';
import { z } from 'zod';
import type { DesktopClient } from '../../../infrastructure/desktop/client';
import type { AgentMux } from '../../../lib/mux';

export const createReadTool = (desktopClient: DesktopClient, mux: AgentMux, conversationId: string) =>
  tool({
    description:
      'Read the contents of a file at the specified path. Use this to inspect existing code, configuration files, or any text file. The path must be absolute or relative to the workspace root.',
    parameters: z.object({
      path: z.string().describe('The file path to read'),
      offset: z.number().optional().describe('Line number to start reading from (1-indexed)'),
      limit: z.number().optional().describe('Maximum number of lines to read'),
    }),
    execute: async ({ path, offset, limit }) => {
      const toolCallId = `read_${Date.now()}`;
      await mux.put({
        type: 'agent:tool_start',
        conversation_id: conversationId,
        tool_call: { id: toolCallId, name: 'read', arguments: JSON.stringify({ path, offset, limit }) },
      });

      try {
        const content = await desktopClient.readFile(path);
        if (content === null) {
          const result = `Error: File not found or unreadable: ${path}`;
          await mux.put({ type: 'agent:tool_end', conversation_id: conversationId, tool_call_id: toolCallId, result });
          return result;
        }

        let lines = content.split('\n');
        if (offset !== undefined && offset > 0) {
          lines = lines.slice(offset - 1);
        }
        if (limit !== undefined && limit > 0) {
          lines = lines.slice(0, limit);
        }

        // Add line numbers
        const startLine = offset ?? 1;
        const numbered = lines.map((line, i) => `${startLine + i}\t${line}`).join('\n');
        const result = numbered;
        await mux.put({ type: 'agent:tool_end', conversation_id: conversationId, tool_call_id: toolCallId, result });
        return result;
      } catch (error) {
        const result = `Error reading file: ${error instanceof Error ? error.message : String(error)}`;
        await mux.put({ type: 'agent:tool_end', conversation_id: conversationId, tool_call_id: toolCallId, result });
        return result;
      }
    },
  });
