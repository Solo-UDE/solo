/**
 * Permission system for Solo IDE.
 */

import { createLogger } from './logger.js';
import { localize } from './nls.js';
import { checkPermission, loadMergedSettings } from './permission-pipeline.js';

import type { PermissionDecision, PermissionMode } from './permission-pipeline.js';
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
  private planModeGetter?: () => boolean;
  private planFilePathGetter?: () => string | null;
  /** Resolver for the workspace path — used to locate `.solo/settings.json`. */
  private workspaceGetter?: () => string;
  /** Resolver for an optional Debug-mode flag. */
  private debugModeGetter?: () => boolean;
  /** Small in-memory cache of parsed settings, keyed by workspace path. */
  private settingsCache = new Map<
    string,
    { mtime: number; settings: ReturnType<typeof loadMergedSettings> }
  >();

  // Tools allowed through in plan mode (planning/reading tools that reach canUseTool)
  private static readonly PLAN_MODE_ALLOWED_TOOLS = new Set([
    'ExitPlanMode',
    'EnterPlanMode',
    'AskUserQuestion',
    'TaskCreate',
    'TaskUpdate',
    'TaskGet',
    'TaskList',
    'ToolSearch',
    'Skill',
  ]);

  constructor(
    requestCallback?: PermissionRequestCallback,
    snapshotCallback?: SnapshotCallback,
    acceptModeGetter?: () => boolean,
    planModeGetter?: () => boolean,
    planFilePathGetter?: () => string | null,
    workspaceGetter?: () => string,
    debugModeGetter?: () => boolean
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
    if (planModeGetter !== undefined) {
      this.planModeGetter = planModeGetter;
    }
    if (planFilePathGetter !== undefined) {
      this.planFilePathGetter = planFilePathGetter;
    }
    if (workspaceGetter !== undefined) {
      this.workspaceGetter = workspaceGetter;
    }
    if (debugModeGetter !== undefined) {
      this.debugModeGetter = debugModeGetter;
    }
  }

  /**
   * Resolve the active mode by consulting all overlay flags.
   *
   * Mutually exclusive — the first truthy flag wins. This matches the
   * frontend's `useSessionMode` selector, keeping the UI and backend in sync.
   */
  private resolveMode(): PermissionMode {
    if (this.acceptModeGetter?.()) return 'accept';
    if (this.planModeGetter?.()) return 'plan';
    if (this.debugModeGetter?.()) return 'debug';
    return 'default';
  }

  /**
   * Load (with a small on-disk mtime cache) the merged settings for the
   * current workspace. Returns `null` when no workspace is configured.
   *
   * We re-check the settings file's mtime on every call so external edits
   * (user hand-editing `.solo/settings.json`) are reflected immediately
   * without a session restart.
   */
  private loadSettings() {
    const ws = this.workspaceGetter?.();
    if (!ws) return null;
    try {
      // The rough freshness signal: combine mtimes of the three scope files.
      // We don't need to be exact — any change to any scope invalidates.
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const fs = require('node:fs');
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const path = require('node:path');
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const os = require('node:os');
      const paths = [
        path.join(os.homedir(), '.solo', 'settings.json'),
        path.join(ws, '.solo', 'settings.json'),
        path.join(ws, '.solo', 'settings.local.json'),
      ] as string[];
      let combinedMtime = 0;
      for (const p of paths) {
        try {
          const stat = fs.statSync(p);
          combinedMtime = Math.max(combinedMtime, stat.mtimeMs);
        } catch {
          // Missing file contributes 0 — that's fine.
        }
      }
      const cached = this.settingsCache.get(ws);
      if (cached && cached.mtime === combinedMtime) {
        return cached.settings;
      }
      const settings = loadMergedSettings(ws);
      this.settingsCache.set(ws, { mtime: combinedMtime, settings });
      return settings;
    } catch (err) {
      logger.warn({ err }, 'Failed to load settings — falling back to mode-only gating');
      return null;
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
   * Preview the permission decision for a tool call WITHOUT invoking any
   * side-effects (no snapshot, no request callback, no UI event).
   *
   * Used by the session-manager's SDK-message consumer to pick the correct
   * INITIAL `status` for a `tool_use` event: `'running'` for tools that will
   * be auto-allowed, `'awaiting-permission'` only for tools that will
   * legitimately prompt the user. This eliminates the 1-frame flash of the
   * approval card that users previously saw on every auto-approved tool.
   *
   * Returns the same three outcomes as `createCallback`, reduced to the
   * behavior axis (message detail is not needed for a preview):
   *
   *   - `'allow'` — the callback will allow without prompting
   *   - `'ask'`   — the callback will emit a permission_request event
   *   - `'deny'`  — the callback will deny and the tool_result will carry the error
   *
   * Mirrors `createCallback` stage-for-stage; keep the two in sync.
   */
  previewDecision(
    toolName: string,
    toolInput: Record<string, unknown>
  ): 'allow' | 'ask' | 'deny' {
    const mode = this.resolveMode();

    // Stage 1: Plan-mode plan-file write exemption.
    if (mode === 'plan' && (toolName === 'Write' || toolName === 'Edit')) {
      const filePath = toolInput.file_path as string | undefined;
      const planPath = this.planFilePathGetter?.();
      if (planPath && filePath === planPath) {
        return 'allow';
      }
    }

    // Stage 2: Settings-driven pipeline.
    const settings = this.loadSettings();
    if (settings !== null) {
      const decision = checkPermission(
        toolName,
        toolInput,
        mode,
        settings.permissions
      );
      if (decision.behavior === 'allow') return 'allow';
      if (decision.behavior === 'deny') return 'deny';
      // decision.behavior === 'ask' — fall through to legacy checks below.
    }

    // Stage 3a: Legacy Plan-mode deny for non-write, non-planning tools.
    if (mode === 'plan') {
      if (
        toolName !== 'Write' &&
        toolName !== 'Edit' &&
        !PermissionManager.PLAN_MODE_ALLOWED_TOOLS.has(toolName)
      ) {
        return 'deny';
      }
    }

    // Stage 3b: Session-scoped always-allowed list (set by prior "Always allow" clicks).
    if (this.isAlwaysAllowed(toolName)) return 'allow';

    // Stage 3c: If there's no requestCallback registered, the real callback
    // would auto-allow as a development-mode fallback. Mirror that here so
    // the preview matches runtime behavior.
    if (!this.requestCallback) return 'allow';

    // Fall-through: the real callback would prompt.
    return 'ask';
  }

  /**
   * Create permission callback for the SDK.
   *
   * This is now a three-stage pipeline:
   *
   * 1. Plan-mode special case for edits targeting the active plan file
   *    (this is Solo-specific and not expressible as a generic rule —
   *    the plan file path is dynamic per session).
   * 2. The settings-driven decision pipeline (mirror of `solo-core::permissions::check`).
   *    This is the single source of truth for allow/ask/deny rules and
   *    the Accept/Plan/Default/Debug mode overlays.
   * 3. Fall-through to the UI permission prompt (requestCallback).
   *
   * **Key property**: under Accept mode, stages 1-2 ALWAYS short-circuit
   * with an Allow (unless a deny/ask rule or the destructive tier blocks
   * it), so `requestCallback` is never invoked and no permission modal
   * is emitted to the frontend. This fixes the modal-flash bug where the
   * UI briefly rendered a permission card before being auto-resolved.
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
      const mode = this.resolveMode();
      logger.debug({ toolName, mode }, 'Permission callback invoked');

      try {
        // Stage 1: Plan-mode plan-file write is a special case that must
        // bypass the generic pipeline (the generic pipeline would either
        // prompt or deny Write/Edit under Plan mode, but we *do* want the
        // agent to write to its own plan file).
        if (mode === 'plan' && (toolName === 'Write' || toolName === 'Edit')) {
          const filePath = toolInput.file_path as string | undefined;
          const planPath = this.planFilePathGetter?.();
          if (planPath && filePath === planPath) {
            logger.info({ toolName, filePath }, 'Plan mode — auto-approving write to plan file');
            return { behavior: 'allow', updatedInput: toolInput };
          }
        }

        // Stage 2: Run the settings-driven pipeline. The settings are loaded
        // with an mtime-cached load so external edits to `.solo/settings.json`
        // are picked up without a session restart.
        const settings = this.loadSettings();
        if (settings !== null) {
          const decision: PermissionDecision = checkPermission(
            toolName,
            toolInput,
            mode,
            settings.permissions
          );
          logger.debug({ toolName, mode, decision }, 'Pipeline decision');

          if (decision.behavior === 'allow') {
            // Capture snapshot for Write/Edit even when auto-allowed — this
            // preserves checkpointing semantics so "undo" still works under
            // Accept mode.
            if ((toolName === 'Write' || toolName === 'Edit') && this.snapshotCallback) {
              try {
                await this.snapshotCallback(toolName, toolInput, null);
              } catch (err) {
                logger.warn({ toolName, err }, 'Snapshot capture failed — continuing anyway');
              }
            }
            return { behavior: 'allow', updatedInput: toolInput };
          }

          if (decision.behavior === 'deny') {
            return {
              behavior: 'deny',
              message: decision.message,
              interrupt: false,
            };
          }

          // decision.behavior === 'ask' — fall through to the UI prompt.
        }

        // Also keep the legacy Plan-mode deny for non-write tools that aren't
        // in the plan-allowed set. This was the previous behavior and is
        // stricter than the generic pipeline (which would just prompt).
        if (mode === 'plan') {
          if (
            toolName !== 'Write' &&
            toolName !== 'Edit' &&
            !PermissionManager.PLAN_MODE_ALLOWED_TOOLS.has(toolName)
          ) {
            logger.info({ toolName }, 'Plan mode — denying non-planning tool');
            return {
              behavior: 'deny',
              message:
                'Plan mode is active. Only read-only tools and plan file edits are allowed. Use ExitPlanMode to switch back.',
            };
          }
        }

        // Snapshot capture for Write/Edit before prompting.
        if ((toolName === 'Write' || toolName === 'Edit') && this.snapshotCallback) {
          try {
            await this.snapshotCallback(toolName, toolInput, null);
          } catch (err) {
            logger.warn({ toolName, err }, 'Snapshot capture failed — continuing anyway');
          }
        }

        // Legacy always-allowed list (session-scoped, from prior "Allow always" clicks).
        if (this.isAlwaysAllowed(toolName)) {
          return { behavior: 'allow', updatedInput: toolInput };
        }

        // Stage 3: Prompt the user via the UI.
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
