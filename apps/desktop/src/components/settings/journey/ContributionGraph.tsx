/**
 * GitHub-style contribution heatmap. 26 weeks × 7 days, ending on today.
 * Full-width fluid grid: cells resize to fill the container, staying square
 * via aspect-ratio. Real-time — subscribes to the dailyActivityStore so a
 * successful `git push` brightens and pulses today's cell within a frame.
 *
 * Color scale (primary-tinted, 5 steps):
 *   0 commits — muted/40
 *   1         — primary/25
 *   2–3       — primary/45
 *   4–6       — primary/70
 *   7+        — primary
 */

import { useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useDailyActivityStore, dailyActivityIsoDay } from '@/stores/dailyActivityStore';

const WEEKS = 26;
const DAYS_PER_WEEK = 7;

type CellMeta = { date: string; count: number; weekday: number; weekIdx: number };

/** Produce a WEEKS×DAYS_PER_WEEK grid of dates ending on today. */
function buildGrid(commitsByDate: Record<string, number>): CellMeta[][] {
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
    const weekIdx = Math.floor(i / DAYS_PER_WEEK);
    const weekday = i % DAYS_PER_WEEK;
    grid[weekIdx]!.push({
      date: key,
      count: commitsByDate[key] ?? 0,
      weekday,
      weekIdx,
    });
  }
  return grid;
}

function bucket(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count === 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
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
  const commitsByDate = useDailyActivityStore((s) => s.commitsByDate);
  const version = useDailyActivityStore((s) => s.version);

  const grid = useMemo(() => buildGrid(commitsByDate), [commitsByDate]);

  const todayKey = dailyActivityIsoDay();
  const todayCount = commitsByDate[todayKey] ?? 0;
  const windowTotal = useMemo(
    () => grid.flat().reduce((acc, c) => acc + c.count, 0),
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
          {todayCount > 0 ? (
            <motion.div
              key={todayCount}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-foreground"
            >
              {todayCount} today
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
              const b = bucket(cell.count);
              const isToday = cell.date === todayKey;
              return (
                <motion.div
                  key={cell.date}
                  className={[
                    'aspect-square rounded-[4px] ring-1 transition-colors',
                    BUCKET_BG[b],
                    BUCKET_RING[b],
                    isToday ? 'outline outline-1 outline-primary/80 outline-offset-[1px]' : '',
                  ].join(' ')}
                  title={`${cell.count} commit${cell.count === 1 ? '' : 's'} · ${formatDate(cell.date)}`}
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
