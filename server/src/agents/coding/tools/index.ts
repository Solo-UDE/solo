/**
 * Tool registry — creates all agent tools bound to a DesktopClient and AgentMux.
 */

import type { DesktopClient } from '../../../infrastructure/desktop/client';
import type { AgentMux } from '../../../lib/mux';
import { createReadTool } from './read';
import { createWriteTool } from './write';
import { createEditTool } from './edit';
import { createBashTool } from './bash';
import { createGrepTool } from './grep';
import { createGlobTool } from './glob-tool';
import { createLsTool } from './ls';

export function createToolRegistry(
  desktopClient: DesktopClient,
  mux: AgentMux,
  conversationId: string,
  requestApproval: (toolCallId: string, name: string, args: string) => Promise<boolean>,
) {
  return {
    read: createReadTool(desktopClient, mux, conversationId),
    write: createWriteTool(desktopClient, mux, conversationId, requestApproval),
    edit: createEditTool(desktopClient, mux, conversationId, requestApproval),
    bash: createBashTool(desktopClient, mux, conversationId, requestApproval),
    grep: createGrepTool(desktopClient, mux, conversationId),
    glob: createGlobTool(desktopClient, mux, conversationId),
    ls: createLsTool(desktopClient, mux, conversationId),
  };
}
