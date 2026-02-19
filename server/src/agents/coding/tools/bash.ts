import { tool } from 'ai';
import { z } from 'zod';
import type { DesktopClient } from '../../../infrastructure/desktop/client';
import type { AgentMux } from '../../../lib/mux';

const bashParams = z.object({
  command: z.string().describe('The shell command to execute'),
});

export const createBashTool = (
  desktopClient: DesktopClient,
  mux: AgentMux,
  conversationId: string,
  requestApproval: (toolCallId: string, name: string, args: string) => Promise<boolean>,
) =>
  tool({
    description:
      'Execute a shell command on the user\'s machine. Use this for running build commands, installing packages, running tests, git operations, or any terminal command. Commands execute in the workspace root directory.',
    inputSchema: bashParams,
    execute: async (args: z.infer<typeof bashParams>) => {
      const { command } = args;
      const toolCallId = `bash_${Date.now()}`;
      const argsStr = JSON.stringify({ command });

      await mux.put({
        type: 'agent:tool_start',
        conversation_id: conversationId,
        tool_call: { id: toolCallId, name: 'bash', arguments: argsStr },
      });

      // Request approval for command execution
      const approved = await requestApproval(toolCallId, 'bash', argsStr);
      if (!approved) {
        const result = 'Tool call rejected by user.';
        await mux.put({ type: 'agent:tool_end', conversation_id: conversationId, tool_call_id: toolCallId, result });
        return result;
      }

      try {
        const output = await desktopClient.runCommand(command);
        const result = output || '(no output)';
        await mux.put({ type: 'agent:tool_end', conversation_id: conversationId, tool_call_id: toolCallId, result });
        return result;
      } catch (error) {
        const result = `Command failed: ${error instanceof Error ? error.message : String(error)}`;
        await mux.put({ type: 'agent:tool_end', conversation_id: conversationId, tool_call_id: toolCallId, result });
        return result;
      }
    },
  });
