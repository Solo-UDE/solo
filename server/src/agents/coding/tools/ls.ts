import { tool } from 'ai';
import { z } from 'zod';
import type { DesktopClient } from '../../../infrastructure/desktop/client';
import type { AgentMux } from '../../../lib/mux';

const lsParams = z.object({
  path: z.string().optional().describe('Directory path to list (default: workspace root)'),
});

export const createLsTool = (desktopClient: DesktopClient, mux: AgentMux, conversationId: string) =>
  tool({
    description:
      'List the contents of a directory. The quick tool to use for discovery, before using more targeted tools like grep or file reading. Useful to understand file structure before diving deeper into specific files. Can be used to explore the codebase and understand project layout.',
    inputSchema: lsParams,
    execute: async (args: z.infer<typeof lsParams>) => {
      const { path } = args;
      const toolCallId = `ls_${Date.now()}`;
      await mux.put({
        type: 'agent:tool_start',
        conversation_id: conversationId,
        tool_call: { id: toolCallId, name: 'ls', arguments: JSON.stringify({ path }) },
      });

      try {
        const entries = await desktopClient.listDirectory(path || '');
        const result = Array.isArray(entries) ? entries.join('\n') : String(entries);
        await mux.put({ type: 'agent:tool_end', conversation_id: conversationId, tool_call_id: toolCallId, result: result || '(empty directory)' });
        return result || '(empty directory)';
      } catch (error) {
        const result = `Error listing directory: ${error instanceof Error ? error.message : String(error)}`;
        await mux.put({ type: 'agent:tool_end', conversation_id: conversationId, tool_call_id: toolCallId, result });
        return result;
      }
    },
  });
