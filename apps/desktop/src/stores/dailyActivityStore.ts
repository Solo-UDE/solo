/**
 * Daily Activity Store — usage heatmap source of truth on the frontend.
 *
 * Data flow:
 *   1. On Journey mount, `hydrateFromServer()` calls the Rust `stats_get_heatmap`
 *      command, which merges DynamoDB's 26-week history with any `pending_daily`
 *      counters that haven't been sync'd yet.
 *   2. Between syncs, `bumpLocal()` is called from gitStore.push on success so
 *      today's cell reflects new commits without waiting on the 60s sync tick.
 *   3. Stats are scoped to the signed-in Cognito user at the Rust layer — the
 *      frontend never sees another user's data.
 *
 * Usage score (per day) — computed here, not on the server, so weights can be
 * tuned without a Lambda deploy. See the Journey page notes for calibration.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { DailyActivityEntry } from '@/bindings';
import { invoke } from '@tauri-apps/api/core';

export interface DailyCounters {
  commits: number;
  tokens: number;
  worktrees: number;
  sessions: number;
  messages: number;
}

const ZERO_COUNTERS: DailyCounters = {
  commits: 0,
  tokens: 0,
  worktrees: 0,
  sessions: 0,
  messages: 0,
};

const isoDay = (d: Date = new Date()): string => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/**
 * Usage score formula (per day). Weighted sum of the five stat counters;
 * tokens are log-damped so a single long conversation can't dominate a day.
 *
 *   commits   × 6   — shipped code, strongest signal
 *   sessions  × 3   — distinct work blocks
 *   worktrees × 2   — new branches/tasks in flight
 *   messages  × 1   — conversational volume
 *   log2(1 + tokens/1000) × 0.5   — scale/depth, log-damped
 */
export function computeUsageScore(c: DailyCounters): number {
  const tokenTerm = Math.log2(1 + c.tokens / 1000) * 0.5;
  return (
    c.commits * 6 +
    c.sessions * 3 +
    c.worktrees * 2 +
    c.messages * 1 +
    tokenTerm
  );
}

/** 5-step bucket matching the GitHub heatmap's intensity scale. */
export function usageBucket(score: number): 0 | 1 | 2 | 3 | 4 {
  if (score <= 0) return 0;
  if (score <= 5) return 1;
  if (score <= 15) return 2;
  if (score <= 35) return 3;
  return 4;
}

interface DailyActivityState {
  countersByDate: Record<string, DailyCounters>;
  isHydrating: boolean;
  lastHydrated: number | null;
  error: string | null;
  version: number;
}

interface DailyActivityActions {
  /** Fetch the server heatmap and replace the local map. */
  hydrateFromServer: () => Promise<void>;
  /** Optimistically add counters to today's bucket for real-time UI feedback. */
  bumpLocal: (delta: Partial<DailyCounters>, at?: Date) => void;
  reset: () => void;
}

export const useDailyActivityStore = create<DailyActivityState & DailyActivityActions>()(
  immer((set) => ({
    countersByDate: {},
    isHydrating: false,
    lastHydrated: null,
    error: null,
    version: 0,

    hydrateFromServer: async () => {
      set((s) => {
        s.isHydrating = true;
        s.error = null;
      });
      try {
        const rows = await invoke<DailyActivityEntry[]>('stats_get_heatmap');
        const next: Record<string, DailyCounters> = {};
        for (const row of rows) {
          next[row.date] = {
            commits: Number(row.commits),
            tokens: Number(row.tokens),
            worktrees: Number(row.worktrees),
            sessions: Number(row.sessions),
            messages: Number(row.messages),
          };
        }
        set((s) => {
          s.countersByDate = next;
          s.lastHydrated = Date.now();
          s.version += 1;
        });
      } catch (err) {
        set((s) => {
          s.error = err instanceof Error ? err.message : String(err);
        });
      } finally {
        set((s) => {
          s.isHydrating = false;
        });
      }
    },

    bumpLocal: (delta, at) => {
      const key = isoDay(at);
      set((s) => {
        const cur = s.countersByDate[key] ?? { ...ZERO_COUNTERS };
        s.countersByDate[key] = {
          commits: cur.commits + (delta.commits ?? 0),
          tokens: cur.tokens + (delta.tokens ?? 0),
          worktrees: cur.worktrees + (delta.worktrees ?? 0),
          sessions: cur.sessions + (delta.sessions ?? 0),
          messages: cur.messages + (delta.messages ?? 0),
        };
        s.version += 1;
      });
    },

    reset: () => {
      set((s) => {
        s.countersByDate = {};
        s.version += 1;
      });
    },
  })),
);

export const dailyActivityIsoDay = isoDay;
