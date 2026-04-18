/**
 * Tauri IPC wrappers for the skills marketplace.
 *
 * Maps to marketplace commands in `apps/desktop/src-tauri/src/` (registry
 * fetch, install, uninstall, search). Phase 3 implements the Rust side;
 * until then these wrappers exist so the UI layer (Phase 2) has something
 * to type-check against.
 */

import { invoke } from '@tauri-apps/api/core';
import type { Registry } from '../../bindings/Registry';
import type { RegistryEntry } from '../../bindings/RegistryEntry';
import type { SkillSuggestion } from '../../bindings/SkillSuggestion';

export type { Registry, RegistryEntry, SkillSuggestion };

/**
 * Fetch the marketplace registry JSON from `solo/skills-registry`.
 * 24h-cached on disk at `~/.solo/cache/registry.json`; pass `force: true`
 * to bypass the cache.
 */
export const fetchRegistry = (force = false) =>
  invoke<Registry>('skills_fetch_registry', { force });

/**
 * Semantically search the cached marketplace for skills matching `query`.
 * The caller passes `installedIds` so the Rust side can filter already-installed
 * entries out of the results.
 */
export const searchMarketplace = (query: string, installedIds: string[]) =>
  invoke<SkillSuggestion[]>('skills_search_marketplace', { query, installedIds });

/** Download + verify + extract a registry skill to `~/.solo/skills/<id>/`. */
export const installSkill = (entry: RegistryEntry) =>
  invoke<void>('skills_install', { entry });

/** Remove an installed skill directory. Refuses if the id escapes the skills root. */
export const uninstallSkill = (skillId: string) =>
  invoke<void>('skills_uninstall', { skillId });

/** Overwrite the `AGENTS.md` of an installed skill (used by the tweak-with-agent flow). */
export const writeInstalledSkill = (skillId: string, content: string) =>
  invoke<void>('skills_write_installed', { skillId, content });

/** Regenerate the workspace-root `AGENTS.md` index of installed skills. */
export const writeWorkspaceAgentsMd = (cwd: string) =>
  invoke<void>('skills_write_workspace_agents_md', { cwd });
