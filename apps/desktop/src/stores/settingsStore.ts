/**
 * Settings Store - Manages user preferences with persistence
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

export type AutosaveDelay = 0 | 5000 | 10000 | 30000 | 'disabled';

interface SettingsState {
  autosaveDelay: AutosaveDelay;
}

interface SettingsActions {
  setAutosaveDelay: (delay: AutosaveDelay) => void;
}

type SettingsStore = SettingsState & SettingsActions;

export const useSettingsStore = create<SettingsStore>()(
  persist(
    immer((set) => ({
      autosaveDelay: 5000 as AutosaveDelay,

      setAutosaveDelay: (delay) =>
        set((s) => {
          s.autosaveDelay = delay;
        }),
    })),
    { name: 'solo-settings', version: 1 }
  )
);

export const AUTOSAVE_OPTIONS: { label: string; value: AutosaveDelay }[] = [
  { label: 'Immediate', value: 0 },
  { label: '5 seconds', value: 5000 },
  { label: '10 seconds', value: 10000 },
  { label: '30 seconds', value: 30000 },
  { label: 'Disabled', value: 'disabled' },
];
