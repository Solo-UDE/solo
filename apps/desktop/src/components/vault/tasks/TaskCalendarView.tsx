import { useMemo, useState, type FC } from 'react';
import { ChevronLeft, ChevronRight, Bot, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/taskStore';
import type { Task } from '@/lib/tauri/tasks';

export const TaskCalendarView: FC = () => {
  const tasksMap = useTaskStore((s) => s.tasks);
  const select = useTaskStore((s) => s.select);
  const tasks = useMemo(() => Array.from(tasksMap.values()), [tasksMap]);

  const [cursor, setCursor] = useState<Date>(() => new Date());
  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  // Build a calendar grid: first Sun on or before day 1, 6 rows of 7
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(1 - firstOfMonth.getDay());

  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    cells.push(d);
  }

  // Bucket tasks by day based on their next scheduled fire (if any).
  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      const sched = t.schedule;
      if (!sched) continue;
      const ts =
        sched.kind === 'cron' ? Number(sched.data.next_fire) :
        sched.kind === 'preset' ? Number(sched.data.next_fire) :
        sched.kind === 'one_shot' ? Number(sched.data.at) :
        null;
      if (!ts) continue;
      const d = new Date(ts);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    return map;
  }, [tasks]);

  const label = cursor.toLocaleString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className="flex h-full min-h-0 flex-col p-3">
      <header className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setCursor(new Date(year, month - 1, 1))}
          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted/50"
        ><ChevronLeft className="h-4 w-4" /></button>
        <span className="min-w-[140px] text-center text-[13px] font-medium">{label}</span>
        <button
          type="button"
          onClick={() => setCursor(new Date(year, month + 1, 1))}
          className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted/50"
        ><ChevronRight className="h-4 w-4" /></button>
        <button
          type="button"
          onClick={() => setCursor(new Date())}
          className="ml-2 rounded-md border border-border/60 bg-card px-2 py-0.5 text-[11px] font-medium hover:bg-muted/60"
        >Today</button>
      </header>

      <div className="grid grid-cols-7 gap-px rounded-md bg-border/40 p-px text-[11px]">
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d) => (
          <div key={d} className="bg-background p-1 text-center font-medium text-muted-foreground">{d}</div>
        ))}
        {cells.map((d, i) => {
          const inMonth = d.getMonth() === month;
          const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
          const dayTasks = tasksByDay.get(key) ?? [];
          const isToday = isSameDay(d, new Date());
          return (
            <div
              key={i}
              className={cn(
                'flex min-h-[70px] flex-col gap-0.5 bg-background p-1',
                !inMonth && 'opacity-40',
                isToday && 'ring-1 ring-inset ring-blue-500/50',
              )}
            >
              <span className="text-[10px] text-muted-foreground tabular-nums">{d.getDate()}</span>
              {dayTasks.slice(0, 3).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => select(t.id)}
                  className="flex items-center gap-1 truncate rounded bg-card px-1 py-0.5 text-left text-[10px] hover:bg-muted/60"
                >
                  {t.executor === 'agent' ? <Bot className="h-2.5 w-2.5 shrink-0" /> : <User className="h-2.5 w-2.5 shrink-0" />}
                  <span className="truncate">{t.title}</span>
                </button>
              ))}
              {dayTasks.length > 3 && (
                <span className="text-[9px] text-muted-foreground">+{dayTasks.length - 3} more</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
