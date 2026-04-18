/**
 * Usage heatmap. 26 weeks × 7 days, ending on today. Full-width fluid grid:
 * cells resize to fill the container, staying square via aspect-ratio.
 *
 * Cell color reflects a *usage score* (not raw commits): a weighted sum of
 * commits, sessions, worktrees, messages, and log-damped tokens. See
 * `computeUsageScore` / `usageBucket` in the store for the formula.
 *
 * Data flow:
 *   - `hydrateFromServer()` pulls the 26-week window from DynamoDB via the
 *     Rust `stats_get_heatmap` command on mount.
 *   - `bumpLocal()` is called from gitStore.push for instant feedback
 *     between syncs.
 */

import { useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  useDailyActivityStore,
  dailyActivityIsoDay,
  computeUsageScore,
  usageBucket,
  type DailyCounters,
} from '@/stores/dailyActivityStore';

const WEEKS = 26;
const DAYS_PER_WEEK = 7;

const ZERO: DailyCounters = { commits: 0, tokens: 0, worktrees: 0, sessions: 0, messages: 0 };

type CellMeta = {
  date: string;
  counters: DailyCounters;
  score: number;
  weekday: number;
  weekIdx: number;
};

/** Produce a WEEKS×DAYS_PER_WEEK grid of dates ending on today. */
function buildGrid(countersByDate: Record<string, DailyCounters>): CellMeta[][] {
  const today = new Date();
  const todayWeekday = today.getDay();
  const totalCells = WEEKS * DAYS_PER_WEEK;
  const startOffset = totalCells - 1 - todayWeekday;
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - startOffset);

  const grid: CellMeta[][] = Array.from({ length: WEEKS }, () => []);
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(startDate);
    d.setDate(startDate.getDate() + i);
    const key = dailyActivityIsoDay(d);
    const counters = countersByDate[key] ?? ZERO;
    const score = computeUsageScore(counters);
    const weekIdx = Math.floor(i / DAYS_PER_WEEK);
    const weekday = i % DAYS_PER_WEEK;
    grid[weekIdx]!.push({ date: key, counters, score, weekday, weekIdx });
  }
  return grid;
}

const BUCKET_BG = [
  'bg-muted/40',
  'bg-primary/25',
  'bg-primary/45',
  'bg-primary/70',
  'bg-primary',
] as const;

const BUCKET_RING = [
  'ring-border/30',
  'ring-primary/30',
  'ring-primary/40',
  'ring-primary/50',
  'ring-primary/60',
] as const;

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function ContributionGraph() {
  const countersByDate = useDailyActivityStore((s) => s.countersByDate);
  const version = useDailyActivityStore((s) => s.version);
  const hydrateFromServer = useDailyActivityStore((s) => s.hydrateFromServer);
  const lastHydrated = useDailyActivityStore((s) => s.lastHydrated);

  // Hydrate once per mount; refresh if data is stale (> 5 min).
  useEffect(() => {
    const STALE_MS = 5 * 60 * 1000;
    if (!lastHydrated || Date.now() - lastHydrated > STALE_MS) {
      void hydrateFromServer();
    }
  }, [hydrateFromServer, lastHydrated]);

  const grid = useMemo(() => buildGrid(countersByDate), [countersByDate]);

  const todayKey = dailyActivityIsoDay();
  const todayCounters = countersByDate[todayKey] ?? ZERO;
  const todayCommits = todayCounters.commits;
  const windowTotal = useMemo(
    () => grid.flat().reduce((acc, c) => acc + c.counters.commits, 0),
    [grid],
  );

  // Month markers aligned to week columns. First occurrence of each month wins.
  const monthMarkers = useMemo(() => {
    const seen = new Set<number>();
    const markers: Array<{ weekIdx: number; label: string }> = [];
    grid.forEach((week, weekIdx) => {
      const first = week[0];
      if (!first) return;
      const [, mm] = first.date.split('-').map(Number);
      if (mm == null) return;
      if (!seen.has(mm)) {
        seen.add(mm);
        markers.push({ weekIdx, label: MONTH_LABELS[mm - 1] ?? '' });
      }
    });
    return markers;
  }, [grid]);

  // Bump on new commits so today's cell can pulse.
  const prevVersion = useRef(version);
  useEffect(() => {
    if (version !== prevVersion.current) {
      prevVersion.current = version;
    }
  }, [version]);

  const flatCells = useMemo(() => grid.flat(), [grid]);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-3xl font-semibold tabular-nums text-foreground leading-none">
            {windowTotal.toLocaleString()}
          </div>
          <div className="mt-1.5 text-[11px] text-muted-foreground/75">
            commits in the last {WEEKS} weeks
          </div>
        </div>
        <AnimatePresence mode="wait">
          {todayCommits > 0 ? (
            <motion.div
              key={todayCommits}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-foreground"
            >
              {todayCommits} today
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {/* Grid wrapper: weekday labels | heatmap */}
      <div className="flex gap-2">
        {/* Weekday labels (fixed narrow column) */}
        <div
          className="grid shrink-0 text-[10px] text-muted-foreground/55 pt-5"
          style={{ gridTemplateRows: `repeat(${DAYS_PER_WEEK}, minmax(0, 1fr))`, rowGap: 3 }}
        >
          {WEEKDAY_LABELS.map((d, i) => (
            <div key={i} className="flex items-center">
              {d}
            </div>
          ))}
        </div>

        {/* Heatmap + month labels stack, full-width */}
        <div className="flex-1 min-w-0 space-y-1">
          {/* Month labels aligned to week columns */}
          <div
            className="grid text-[10px] text-muted-foreground/60 h-4"
            style={{ gridTemplateColumns: `repeat(${WEEKS}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: WEEKS }, (_, weekIdx) => {
              const marker = monthMarkers.find((m) => m.weekIdx === weekIdx);
              return (
                <div key={weekIdx} className="overflow-visible whitespace-nowrap">
                  {marker?.label ?? ''}
                </div>
              );
            })}
          </div>

          {/* Heatmap grid */}
          <div
            className="grid"
            style={{
              gridTemplateColumns: `repeat(${WEEKS}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${DAYS_PER_WEEK}, minmax(0, 1fr))`,
              gridAutoFlow: 'column',
              gap: 3,
            }}
          >
            {flatCells.map((cell) => {
              const b = usageBucket(cell.score);
              const isToday = cell.date === todayKey;
              const { commits, sessions, messages } = cell.counters;
              const tip = [
                formatDate(cell.date),
                `usage ${cell.score.toFixed(1)}`,
                `${commits}c · ${sessions}s · ${messages}m`,
              ].join(' · ');
              return (
                <motion.div
                  key={cell.date}
                  className={[
                    'aspect-square rounded-[4px] ring-1 transition-colors',
                    BUCKET_BG[b],
                    BUCKET_RING[b],
                    isToday ? 'outline outline-1 outline-primary/80 outline-offset-[1px]' : '',
                  ].join(' ')}
                  title={tip}
                  animate={
                    isToday && version !== 0
                      ? { scale: [1, 1.22, 1] }
                      : undefined
                  }
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-end gap-2 text-[10px] text-muted-foreground/65">
        <span>Less</span>
        {BUCKET_BG.map((bg, i) => (
          <div
            key={i}
            className={`h-2.5 w-2.5 rounded-[3px] ring-1 ${bg} ${BUCKET_RING[i]}`}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
