/**
 * Skill Store
 *
 * Manages available skills discovered from .solo/skills/ directories
 * and tracks which skills are attached to the current message.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { skillsListAvailable } from '../lib/tauri/skills';

import type { SkillInfo } from '../lib/tauri/skills';

interface SkillState {
  /** All discovered skills (user + project, merged) */
  available: SkillInfo[];
  /** Names of skills attached to the current compose context */
  attached: Set<string>;
  /** Whether skills have been loaded at least once */
  loaded: boolean;
}

interface SkillActions {
  /** Fetch available skills from disk via Tauri */
  loadSkills: (cwd: string) => Promise<void>;
  /** Attach a skill by name */
  attachSkill: (name: string) => void;
  /** Detach a skill by name */
  detachSkill: (name: string) => void;
  /** Toggle a skill's attached state */
  toggleSkill: (name: string) => void;
  /** Clear all attached skills */
  clearAttached: () => void;
  /** Get the full SkillInfo for an attached skill */
  getAttachedSkills: () => SkillInfo[];
}

type SkillStore = SkillState & SkillActions;

export const useSkillStore = create<SkillStore>()(
  immer((set, get) => ({
    available: [],
    attached: new Set<string>(),
    loaded: false,

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

    attachSkill: (name: string) => {
      set((state) => {
        state.attached.add(name);
      });
    },

    detachSkill: (name: string) => {
      set((state) => {
        state.attached.delete(name);
      });
    },

    toggleSkill: (name: string) => {
      set((state) => {
        if (state.attached.has(name)) {
          state.attached.delete(name);
        } else {
          state.attached.add(name);
        }
      });
    },

    clearAttached: () => {
      set((state) => {
        state.attached = new Set();
      });
    },

    getAttachedSkills: () => {
      const { available, attached } = get();
      return available.filter((s) => attached.has(s.name));
    },
  }))
);
