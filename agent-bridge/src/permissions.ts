/**
 * Permission system for Orbit Editor.
 */

import { createLogger } from './logger.js';
import { localize } from './nls.js';

import type { PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';

const logger = createLogger('PermissionManager');

// Constants for content preview lengths
const CONTENT_PREVIEW_LENGTH = 100;
const STRING_PREVIEW_LENGTH = 50;

/**
 * Callback type for permission requests
 */
export type PermissionRequestCallback = (
  toolName: string,
  toolInput: Record<string, unknown>,
  context: {
    signal: AbortSignal;
    suggestions?: unknown[];
  }
) => Promise<{
  decision: 'approve' | 'deny';
  always: boolean;
  /** For AskUserQuestion tool - user's answers to the questions */
  answers?: Record<string, string>;
}>;

/**
 * Callback type for file snapshots (checkpointing)
 */
export type SnapshotCallback = (
  toolName: string,
  toolInput: Record<string, unknown>,
  toolUseId: string | null
) => Promise<void>;

/**
 * Manages permission requests for tool usage.
 */
export class PermissionManager {
  private requestCallback?: PermissionRequestCallback;
  private snapshotCallback?: SnapshotCallback;
  private alwaysAllowedTools = new Set<string>();
  private acceptModeGetter?: () => boolean;

  constructor(
    requestCallback?: PermissionRequestCallback,
    snapshotCallback?: SnapshotCallback,
    acceptModeGetter?: () => boolean
  ) {
    if (requestCallback !== undefined) {
      this.requestCallback = requestCallback;
    }
    if (snapshotCallback !== undefined) {
      this.snapshotCallback = snapshotCallback;
    }
    if (acceptModeGetter !== undefined) {
      this.acceptModeGetter = acceptModeGetter;
    }
  }

  /**
   * Reset the always-allowed tools set.
   */
  resetAlwaysAllowed(): void {
    this.alwaysAllowedTools.clear();
  }

  /**
   * Add a tool to the always-allowed list.
   */
  addAlwaysAllowed(toolName: string): void {
    this.alwaysAllowedTools.add(toolName);
  }

  /**
   * Check if a tool is always allowed.
   */
  isAlwaysAllowed(toolName: string): boolean {
    return this.alwaysAllowedTools.has(toolName);
  }

  /**
   * Create permission callback for the SDK.
   * This uses the SDK's canUseTool API.
   */
  createCallback() {
    return async (
      toolName: string,
      toolInput: Record<string, unknown>,
      options: {
        signal: AbortSignal;
        suggestions?: unknown[];
      }
    ): Promise<PermissionResult> => {
      logger.debug({ toolName, toolInput }, 'Permission callback invoked');

      try {
        // Check Accept mode FIRST - auto-approve ALL tools when active
        // This allows dynamic mode switching without session restart
        const acceptModeActive = this.acceptModeGetter?.() ?? false;
        logger.debug({ toolName, acceptModeActive }, 'Permission check');

        if (acceptModeActive) {
          logger.debug({ toolName }, 'Accept mode active - auto-approving tool');
          return {
            behavior: 'allow',
            updatedInput: toolInput,
          };
        }

        // Capture file snapshot BEFORE Write/Edit tools execute (for checkpointing)
        if ((toolName === 'Write' || toolName === 'Edit') && this.snapshotCallback) {
          try {
            await this.snapshotCallback(toolName, toolInput, null);
          } catch (error) {
            // Don't block tool execution if snapshot fails
            logger.warn({ toolName, error }, 'Failed to capture snapshot');
          }
        }

        // Check if this tool is in the always-allowed list
        if (this.isAlwaysAllowed(toolName)) {
          return {
            behavior: 'allow',
            updatedInput: toolInput,
          };
        }

        // Request permission
        if (this.requestCallback) {
          try {
            const result = await this.requestCallback(toolName, toolInput, options);

            // Handle "always" choice (not applicable to AskUserQuestion)
            if (result.always && toolName !== 'AskUserQuestion') {
              this.addAlwaysAllowed(toolName);
            }

            // Return based on decision
            if (result.decision === 'approve') {
              // For ExitPlanMode, include permission updates to set mode back to 'default'
              // This tells the SDK to change the permission mode for the session
              const updatedPermissions: PermissionUpdate[] | undefined =
                toolName === 'ExitPlanMode'
                  ? [{ type: 'setMode', mode: 'default', destination: 'session' }]
                  : undefined;

              // For AskUserQuestion, include the answers in updatedInput
              // SDK expects: { questions: [...], answers: { "question text": "answer" } }
              let updatedInput = toolInput;
              if (toolName === 'AskUserQuestion' && result.answers) {
                updatedInput = {
                  ...toolInput,
                  answers: result.answers,
                };
                logger.debug({ answers: result.answers }, 'AskUserQuestion answers received');
              }

              return {
                behavior: 'allow',
                updatedInput,
                updatedPermissions,
              };
            }

            return {
              behavior: 'deny',
              message: localize('orbit.permissionDenied', 'User denied permission'),
              interrupt: false,
            };
          } catch (error) {
            // If permission request fails, deny to avoid silent auto-approval
            logger.error({ toolName, error }, 'Permission request failed - DENYING');
            return {
              behavior: 'deny',
              message: localize(
                'orbit.permissionFailed',
                'Permission request failed. Please try again.'
              ),
              interrupt: false,
            };
          }
        }

        // No callback, auto-allow (development mode)
        return {
          behavior: 'allow',
          updatedInput: toolInput,
        };
      } catch (error) {
        // Catch-all: if ANYTHING goes wrong in the callback, deny to avoid silent auto-approval
        logger.error(
          { error },
          'CRITICAL: Permission callback crashed - DENYING to prevent silent approval'
        );
        return {
          behavior: 'deny',
          message: localize(
            'orbit.permissionSystemError',
            'Permission system error. Please try again.'
          ),
          interrupt: false,
        };
      }
    };
  }
}

/**
 * Extract parameters for file operation tools (Read, Write, Edit, NotebookEdit).
 */
function extractFileOperationParams(
  toolName: string,
  toolInput: Record<string, unknown>
): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  if (toolName === 'Read') {
    params.file_path = toolInput.file_path ?? 'N/A';
    if (toolInput.offset !== undefined) {
      params.offset = toolInput.offset;
    }
    if (toolInput.limit !== undefined) {
      params.limit = toolInput.limit;
    }
  } else if (toolName === 'Write') {
    params.file_path = toolInput.file_path ?? 'N/A';
    const contentValue = toolInput.content;
    const content = typeof contentValue === 'string' ? contentValue : '';
    params.content_length = content.length;
    params.content_preview =
      content.length > CONTENT_PREVIEW_LENGTH
        ? content.substring(0, CONTENT_PREVIEW_LENGTH)
        : content;
  } else if (toolName === 'Edit') {
    params.file_path = toolInput.file_path ?? 'N/A';
    const oldValue = toolInput.old_string;
    const newValue = toolInput.new_string;
    params.old_string = (typeof oldValue === 'string' ? oldValue : '').substring(
      0,
      STRING_PREVIEW_LENGTH
    );
    params.new_string = (typeof newValue === 'string' ? newValue : '').substring(
      0,
      STRING_PREVIEW_LENGTH
    );
    if (toolInput.replace_all === true) {
      params.replace_all = true;
    }
  } else if (toolName === 'NotebookEdit') {
    params.notebook_path = toolInput.notebook_path ?? 'N/A';
    params.cell_number = toolInput.cell_number ?? 'N/A';
  }

  return params;
}

/**
 * Extract parameters for Bash-related tools (Bash, BashOutput, KillShell).
 */
function extractBashToolParams(
  toolName: string,
  toolInput: Record<string, unknown>
): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  if (toolName === 'Bash') {
    params.command = toolInput.command ?? 'N/A';
    const timeout = toolInput.timeout;
    if (typeof timeout === 'number') {
      params.timeout = `${String(timeout)}ms`;
    }
    if (toolInput.run_in_background === true) {
      params.background = true;
    }
  } else if (toolName === 'BashOutput') {
    params.bash_id = toolInput.bash_id ?? 'N/A';
  } else if (toolName === 'KillShell') {
    params.shell_id = toolInput.shell_id ?? 'N/A';
  }

  return params;
}

/**
 * Extract parameters for search tools (Glob, Grep).
 */
function extractSearchToolParams(
  toolName: string,
  toolInput: Record<string, unknown>
): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  if (toolName === 'Glob') {
    params.pattern = toolInput.pattern ?? 'N/A';
    if (toolInput.path !== undefined) {
      params.path = toolInput.path;
    }
  } else if (toolName === 'Grep') {
    params.pattern = toolInput.pattern ?? 'N/A';
    params.path = toolInput.path ?? 'current directory';
  }

  return params;
}

/**
 * Extract parameters for web tools (WebSearch, WebFetch).
 */
function extractWebToolParams(
  toolName: string,
  toolInput: Record<string, unknown>
): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  if (toolName === 'WebSearch') {
    params.query = toolInput.query ?? 'N/A';
  } else if (toolName === 'WebFetch') {
    params.url = toolInput.url ?? 'N/A';
  }

  return params;
}

/**
 * Extract parameters for planning/organization tools (Task, TodoWrite, ExitPlanMode).
 */
function extractPlanningToolParams(
  toolName: string,
  toolInput: Record<string, unknown>
): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  if (toolName === 'Task') {
    params.subagent_type = toolInput.subagent_type ?? 'N/A';
    params.description = toolInput.description ?? 'N/A';
  } else if (toolName === 'TodoWrite') {
    const todos = toolInput.todos as unknown[];
    params.todo_count = Array.isArray(todos) ? todos.length : 0;
  } else if (toolName === 'ExitPlanMode') {
    const planValue = toolInput.plan;
    const plan = typeof planValue === 'string' ? planValue : '';
    params.plan_preview =
      plan.length > CONTENT_PREVIEW_LENGTH ? plan.substring(0, CONTENT_PREVIEW_LENGTH) : plan;
  }

  return params;
}

/**
 * Extract relevant parameters from tool input for display.
 */
export function extractToolParams(
  toolName: string,
  toolInput: Record<string, unknown>
): Record<string, unknown> {
  // File operation tools
  if (['Read', 'Write', 'Edit', 'NotebookEdit'].includes(toolName)) {
    return extractFileOperationParams(toolName, toolInput);
  }

  // Bash/execution tools
  if (['Bash', 'BashOutput', 'KillShell'].includes(toolName)) {
    return extractBashToolParams(toolName, toolInput);
  }

  // Search tools
  if (['Glob', 'Grep'].includes(toolName)) {
    return extractSearchToolParams(toolName, toolInput);
  }

  // Web tools
  if (['WebSearch', 'WebFetch'].includes(toolName)) {
    return extractWebToolParams(toolName, toolInput);
  }

  // Planning/organization tools
  if (['Task', 'TodoWrite', 'ExitPlanMode'].includes(toolName)) {
    return extractPlanningToolParams(toolName, toolInput);
  }

  // For unknown tools, return all parameters
  return toolInput;
}
