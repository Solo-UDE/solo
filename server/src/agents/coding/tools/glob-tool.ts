import { tool } from 'ai';
import { z } from 'zod';
import type { DesktopClient } from '../../../infrastructure/desktop/client';
import type { AgentMux } from '../../../lib/mux';

export const createGlobTool = (desktopClient: DesktopClient, mux: AgentMux, conversationId: string) =>
  tool({
    description:
      'Find files matching a glob pattern. Use this to discover files by name pattern (e.g., "**/*.ts", "src/**/*.tsx"). Returns a list of matching file paths.',
    parameters: z.object({
      pattern: z.string().describe('The glob pattern to match files against (e.g., "**/*.ts")'),
      path: z.string().optional().describe('Directory to search in (default: workspace root)'),
    }),
    execute: async ({ pattern, path }) => {
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
