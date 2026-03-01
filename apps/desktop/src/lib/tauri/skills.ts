/**
 * Tauri IPC wrappers for skills discovery commands.
 *
 * Maps to `skills_commands.rs` — scans `.solo/skills/` directories.
 */

import { invoke } from '@tauri-apps/api/core';

export interface SkillInfo {
  name: string;
  description: string;
  content: string;
  source: 'user' | 'project';
  file_path: string;
  enabled: boolean;
  priority: number;
}

/**
 * List all available skills from user (~/.solo/skills/) and project ({cwd}/.solo/skills/).
 * Project skills override user skills with the same name.
 */
export const skillsListAvailable = (cwd: string) =>
  invoke<SkillInfo[]>('skills_list_available', { cwd });
