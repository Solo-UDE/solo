/**
 * Tauri IPC wrappers for skills discovery, authoring, and onboarding.
 *
 * Maps to `skills_commands.rs`. Solo reads from its own `.solo/skills/`
 * directories and from adapter sources (Claude Code, Codex) to stay
 * portable across tools without forcing users to migrate files.
 */

import { invoke } from '@tauri-apps/api/core';
import type { SkillInfo } from '../../bindings/SkillInfo';
import type { SkillWriteRequest } from '../../bindings/SkillWriteRequest';
import type { SkillsOnboardingStatus } from '../../bindings/SkillsOnboardingStatus';
import type { OnboardingImportMode } from '../../bindings/OnboardingImportMode';
import type { SkillsConfig } from '../../bindings/SkillsConfig';

export type { SkillInfo, SkillWriteRequest, SkillsOnboardingStatus, OnboardingImportMode, SkillsConfig };

/**
 * List every skill Solo can see from all enabled sources, deduped by name
 * with priority: project > user > claude_project > claude_user > claude_plugin > codex.
 */
export const skillsListAvailable = (cwd: string) =>
  invoke<SkillInfo[]>('skills_list_available', { cwd });

/**
 * Create/overwrite a `.solo/skills/<name>/SKILL.md` file. Only `user` or
 * `project` scopes are writable — attempts to write to a Claude/Codex
 * source reject at the Rust layer.
 */
export const skillsWriteSkill = (req: SkillWriteRequest) =>
  invoke<string>('skills_write_skill', { req });

/** Probe first-launch state to decide whether to show the import dialog. */
export const skillsOnboardingStatus = (cwd: string) =>
  invoke<SkillsOnboardingStatus>('skills_onboarding_status', { cwd });

/**
 * Apply the user's onboarding choice. `ReadOnly` keeps adapters enabled
 * without touching files; `Copy` snapshots external skills into `~/.solo/
 * skills/`; `Symlink` live-links them.
 *
 * Returns the number of skills physically imported (0 for ReadOnly).
 */
export const skillsOnboardingApply = (cwd: string, mode: OnboardingImportMode) =>
  invoke<number>('skills_onboarding_apply', { cwd, mode });

/** Dismiss onboarding permanently without importing. */
export const skillsOnboardingDismiss = (cwd: string) =>
  invoke<void>('skills_onboarding_dismiss', { cwd });

/** Re-arm the onboarding dialog — useful from Settings → Skills. */
export const skillsOnboardingReset = (cwd: string) =>
  invoke<void>('skills_onboarding_reset', { cwd });

/** Toggle individual source adapters (null = leave unchanged). */
export const skillsSetImports = (
  cwd: string,
  opts: {
    claudeUser?: boolean | null;
    claudePlugins?: boolean | null;
    claudeProject?: boolean | null;
    codex?: boolean | null;
  }
) =>
  invoke<SkillsConfig>('skills_set_imports', {
    cwd,
    claudeUser: opts.claudeUser ?? null,
    claudePlugins: opts.claudePlugins ?? null,
    claudeProject: opts.claudeProject ?? null,
    codex: opts.codex ?? null,
  });
