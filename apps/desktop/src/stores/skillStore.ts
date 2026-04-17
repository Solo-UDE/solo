/**
 * Skill Store
 *
 * Manages available skills discovered from `.solo/skills/` plus adapter
 * sources (Claude Code, Codex). Attachment state lives in the editor
 * (Option D — chips are first-class editor nodes), so the store only
 * tracks the catalog and onboarding state.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  skillsListAvailable,
  skillsOnboardingStatus,
  skillsOnboardingApply,
  skillsOnboardingDismiss,
  skillsWriteSkill,
} from '../lib/tauri/skills';

import type {
  SkillInfo,
  SkillsOnboardingStatus,
  OnboardingImportMode,
  SkillWriteRequest,
} from '../lib/tauri/skills';

interface SkillState {
  /** All discovered skills (Solo + adapter sources, merged and deduped). */
  available: SkillInfo[];
  /** Whether skills have been loaded at least once. */
  loaded: boolean;
  /** Onboarding probe result — null until `checkOnboarding` has run. */
  onboarding: SkillsOnboardingStatus | null;
}

interface SkillActions {
  loadSkills: (cwd: string) => Promise<void>;
  /** Probe whether first-launch onboarding should be offered. */
  checkOnboarding: (cwd: string) => Promise<void>;
  /** Apply the user's onboarding choice, then reload skills. */
  applyOnboarding: (cwd: string, mode: OnboardingImportMode) => Promise<number>;
  /** Dismiss onboarding without importing. */
  dismissOnboarding: (cwd: string) => Promise<void>;
  /** Persist a new skill to disk (agent-driven write), then reload. */
  saveSkill: (cwd: string, req: SkillWriteRequest) => Promise<string>;
}

type SkillStore = SkillState & SkillActions;

export const useSkillStore = create<SkillStore>()(
  immer((set, get) => ({
    available: [],
    loaded: false,
    onboarding: null,

    loadSkills: async (cwd: string) => {
      try {
        const skills = await skillsListAvailable(cwd);
        set((state) => {
          state.available = skills;
          state.loaded = true;
        });
      } catch (err) {
        console.warn('[SkillStore] Failed to load skills:', err);
        set((state) => {
          state.available = [];
          state.loaded = true;
        });
      }
    },

    checkOnboarding: async (cwd) => {
      try {
        const status = await skillsOnboardingStatus(cwd);
        set((state) => {
          state.onboarding = status;
        });
      } catch (err) {
        console.warn('[SkillStore] onboarding probe failed:', err);
      }
    },

    applyOnboarding: async (cwd, mode) => {
      const imported = await skillsOnboardingApply(cwd, mode);
      set((state) => {
        if (state.onboarding) {
          state.onboarding.shouldPrompt = false;
        }
      });
      await get().loadSkills(cwd);
      return imported;
    },

    dismissOnboarding: async (cwd) => {
      await skillsOnboardingDismiss(cwd);
      set((state) => {
        if (state.onboarding) {
          state.onboarding.shouldPrompt = false;
        }
      });
    },

    saveSkill: async (cwd, req) => {
      const path = await skillsWriteSkill(req);
      await get().loadSkills(cwd);
      return path;
    },
  }))
);
