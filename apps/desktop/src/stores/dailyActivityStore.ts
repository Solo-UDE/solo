/**
 * Daily Activity Store — tracks per-day commit counts for the
 * contribution-graph heatmap on the Journey page. Purely client-side for
 * now: incremented when a git push succeeds, persisted to localStorage.
 * Historical data starts empty and accumulates forward.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

const isoDay = (d: Date = new Date()): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

interface DailyActivityState {
  commitsByDate: Record<string, number>;
  /** Monotonically incremented on each update so consumers can react. */
  version: number;
}

interface DailyActivityActions {
  recordCommits: (count: number, at?: Date) => void;
  reset: () => void;
}

export const useDailyActivityStore = create<DailyActivityState & DailyActivityActions>()(
  persist(
    immer((set) => ({
      commitsByDate: {},
      version: 0,

      recordCommits: (count, at) => {
        if (count <= 0) return;
        const key = isoDay(at);
        set((state) => {
          state.commitsByDate[key] = (state.commitsByDate[key] ?? 0) + count;
          state.version += 1;
        });
      },

      reset: () => {
        set((state) => {
          state.commitsByDate = {};
          state.version += 1;
        });
      },
    })),
    {
      name: 'solo-daily-activity',
      partialize: (state) => ({ commitsByDate: state.commitsByDate }),
    },
  ),
);

export const dailyActivityIsoDay = isoDay;
