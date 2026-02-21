import { tool } from 'ai';
import { z } from 'zod';
import type { DesktopClient } from '../../../infrastructure/desktop/client';
import type { AgentMux } from '../../../lib/mux';

const globParams = z.object({
  pattern: z.string().describe('The glob pattern to match files against (e.g., "**/*.ts")'),
  path: z.string().optional().describe('Directory to search in (default: workspace root)'),
});

export const createGlobTool = (desktopClient: DesktopClient, mux: AgentMux, conversationId: string) =>
  tool({
    description:
      'Find all files matching a glob pattern. Useful for discovering files by naming patterns or extensions. Examples: "*.json", "src/**/*.test.tsx", "**/README.md", "**/*.css". Returns a sorted list of matching file paths. Use this before grep when you need to know what files exist.',
    inputSchema: globParams,
    execute: async (args: z.infer<typeof globParams>) => {
      const { pattern, path } = args;
      const toolCallId = `glob_${Date.now()}`;
      await mux.put({
        type: 'agent:tool_start',
        conversation_id: conversationId,
        tool_call: { id: toolCallId, name: 'glob', arguments: JSON.stringify({ pattern, path }) },
      });

      try {
        const result = await desktopClient.glob(pattern, { path });
        await mux.put({ type: 'agent:tool_end', conversation_id: conversationId, tool_call_id: toolCallId, result: result || '(no matches)' });
        return result || '(no matches)';
      } catch (error) {
        const result = `Glob error: ${error instanceof Error ? error.message : String(error)}`;
        await mux.put({ type: 'agent:tool_end', conversation_id: conversationId, tool_call_id: toolCallId, result });
        return result;
      }
    },
  });
