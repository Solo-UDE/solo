import { tool } from 'ai';
import { z } from 'zod';
import type { DesktopClient } from '../../../infrastructure/desktop/client';
import type { AgentMux } from '../../../lib/mux';

const grepParams = z.object({
  pattern: z.string().describe('The regex pattern to search for'),
  path: z.string().optional().describe('Directory or file to search in (default: workspace root)'),
  glob: z.string().optional().describe('Glob pattern to filter files (e.g., "*.ts", "*.{ts,tsx}")'),
  output_mode: z.enum(['content', 'files_with_matches', 'count']).optional()
    .describe('Output mode: content (matching lines), files_with_matches (file paths only), count (match counts)'),
  case_insensitive: z.boolean().optional().describe('Enable case-insensitive search'),
  head_limit: z.number().optional().describe('Limit output to first N results'),
});

export const createGrepTool = (desktopClient: DesktopClient, mux: AgentMux, conversationId: string) =>
  tool({
    description:
      'Search for exact text or regex patterns across files using ripgrep. Use output_mode "files_with_matches" (default) to find which files contain a pattern, "content" to see matching lines with context, or "count" for match counts. Filter files with the glob parameter (e.g., "*.ts" for TypeScript). This is your primary tool for searching codebases — use it to find function definitions, imports, usage patterns, or any text.',
    inputSchema: grepParams,
    execute: async (args: z.infer<typeof grepParams>) => {
      const { pattern, path, glob, output_mode, case_insensitive, head_limit } = args;
      const toolCallId = `grep_${Date.now()}`;
      await mux.put({
        type: 'agent:tool_start',
        conversation_id: conversationId,
        tool_call: { id: toolCallId, name: 'grep', arguments: JSON.stringify({ pattern, path, glob }) },
      });

      try {
        const result = await desktopClient.grep(pattern, {
          path,
          glob,
          output_mode: output_mode as any,
          caseInsensitive: case_insensitive,
          head_limit,
        });
        await mux.put({ type: 'agent:tool_end', conversation_id: conversationId, tool_call_id: toolCallId, result: result || '(no matches)' });
        return result || '(no matches)';
      } catch (error) {
        const result = `Grep error: ${error instanceof Error ? error.message : String(error)}`;
        await mux.put({ type: 'agent:tool_end', conversation_id: conversationId, tool_call_id: toolCallId, result });
        return result;
      }
    },
  });
