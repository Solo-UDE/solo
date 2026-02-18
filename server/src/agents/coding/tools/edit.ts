import { tool } from 'ai';
import { z } from 'zod';
import type { DesktopClient } from '../../../infrastructure/desktop/client';
import type { AgentMux } from '../../../lib/mux';

export const createEditTool = (
  desktopClient: DesktopClient,
  mux: AgentMux,
  conversationId: string,
  requestApproval: (toolCallId: string, name: string, args: string) => Promise<boolean>,
) =>
  tool({
    description:
      'Edit a file by replacing an exact string match with new content. The old_string must match exactly (including whitespace/indentation). Use this for targeted edits to existing files rather than rewriting entire files.',
    parameters: z.object({
      path: z.string().describe('The file path to edit'),
      old_string: z.string().describe('The exact string to find and replace'),
      new_string: z.string().describe('The replacement string'),
    }),
    execute: async ({ path, old_string, new_string }) => {
      const toolCallId = `edit_${Date.now()}`;
      const args = JSON.stringify({ path, old_string: old_string.slice(0, 100), new_string: new_string.slice(0, 100) });

      await mux.put({
        type: 'agent:tool_start',
        conversation_id: conversationId,
        tool_call: { id: toolCallId, name: 'edit', arguments: args },
      });

      // Request approval for edit operations
      const approved = await requestApproval(toolCallId, 'edit', JSON.stringify({ path, old_string, new_string }));
      if (!approved) {
        const result = 'Tool call rejected by user.';
        await mux.put({ type: 'agent:tool_end', conversation_id: conversationId, tool_call_id: toolCallId, result });
        return result;
      }

      try {
        // Read current file
        const content = await desktopClient.readFile(path);
        if (content === null) {
          const result = `Error: File not found: ${path}`;
          await mux.put({ type: 'agent:tool_end', conversation_id: conversationId, tool_call_id: toolCallId, result });
          return result;
        }

        // Find and replace
        const index = content.indexOf(old_string);
        if (index === -1) {
          const result = `Error: Could not find the specified string in ${path}. Make sure the old_string matches exactly including whitespace.`;
          await mux.put({ type: 'agent:tool_end', conversation_id: conversationId, tool_call_id: toolCallId, result });
          return result;
        }

        // Check for multiple matches
        const secondIndex = content.indexOf(old_string, index + 1);
        if (secondIndex !== -1) {
          const result = `Error: The old_string matches multiple locations in ${path}. Provide more surrounding context to make the match unique.`;
          await mux.put({ type: 'agent:tool_end', conversation_id: conversationId, tool_call_id: toolCallId, result });
          return result;
        }

        const newContent = content.slice(0, index) + new_string + content.slice(index + old_string.length);
        await desktopClient.writeFile(path, newContent);

        const result = `Successfully edited ${path}`;
        await mux.put({ type: 'agent:tool_end', conversation_id: conversationId, tool_call_id: toolCallId, result });
        return result;
      } catch (error) {
        const result = `Error editing file: ${error instanceof Error ? error.message : String(error)}`;
        await mux.put({ type: 'agent:tool_end', conversation_id: conversationId, tool_call_id: toolCallId, result });
        return result;
      }
    },
  });
