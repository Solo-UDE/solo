/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Recursive Labs. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * Session mode determines tool access for Orbit editors.
 * Extensible for future modes (review, debug, etc.)
 */
export type OrbitSessionMode = 'chat' | 'agent';

/**
 * Tools allowed per mode.
 *
 * Chat mode: Read-only tools + web access + note-taking
 * Agent mode: All tools (full Claude Code capabilities)
 */
export const MODE_TOOLS: Record<OrbitSessionMode, string[]> = {
  chat: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite'],
  agent: [
    'Read',
    'Write',
    'Edit',
    'Glob',
    'Grep',
    'NotebookEdit',
    'Bash',
    'BashOutput',
    'KillShell',
    'WebSearch',
    'WebFetch',
    'Task',
    'TodoWrite',
    'ExitPlanMode',
  ],
};

/**
 * Get allowed tools for a given mode.
 */
export function getAllowedToolsForMode(mode: OrbitSessionMode): string[] {
  return MODE_TOOLS[mode];
}

/**
 * Check if a tool is allowed in a mode.
 */
export function isToolAllowedInMode(tool: string, mode: OrbitSessionMode): boolean {
  return getAllowedToolsForMode(mode).includes(tool);
}

/**
 * Get display name for a mode.
 */
export function getModeDisplayName(mode: OrbitSessionMode): string {
  switch (mode) {
    case 'chat':
      return 'Chat';
    case 'agent':
      return 'Agent';
    default:
      return 'Agent';
  }
}
