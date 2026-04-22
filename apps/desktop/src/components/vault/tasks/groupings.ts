import type { Task } from '@/lib/tauri/tasks';

export type GroupKey = 'status' | 'priority' | 'executor' | 'cadence' | 'none';

export interface TaskGroup {
  readonly id: string;
  readonly label: string;
  readonly tasks: readonly Task[];
}

export const GROUPING_LABELS: Record<GroupKey, string> = {
  status:   'Status',
  priority: 'Priority',
  executor: 'Executor',
  cadence:  'Cadence',
  none:     'No grouping',
};

const STATUS_ORDER: Task['status'][] = [
  'suggested', 'queued', 'running', 'needs_review', 'done', 'failed', 'archived',
];
const PRIORITY_ORDER: Task['priority'][] = ['urgent', 'high', 'medium', 'low'];
const EXECUTOR_ORDER: Task['executor'][] = ['agent', 'manual'];

export function groupTasks(tasks: readonly Task[], key: GroupKey): TaskGroup[] {
  if (key === 'none') {
    return [{ id: 'all', label: `All (${tasks.length})`, tasks }];
  }

  if (key === 'cadence') {
    const buckets = new Map<string, Task[]>();
    for (const t of tasks) {
      const k = t.schedule ? t.schedule.kind : 'none';
      const list = buckets.get(k) ?? [];
      list.push(t);
      buckets.set(k, list);
    }
    const order: string[] = ['cron', 'preset', 'one_shot', 'event_triggered', 'none'];
    return order
      .filter((k) => buckets.has(k))
      .map((k) => ({
        id: k,
        label: cadenceLabel(k),
        tasks: buckets.get(k) ?? [],
      }));
  }

  const buckets = new Map<string, Task[]>();
  for (const t of tasks) {
    const k = t[key as 'status' | 'priority' | 'executor'];
    const list = buckets.get(k) ?? [];
    list.push(t);
    buckets.set(k, list);
  }
  const order =
    key === 'status'   ? STATUS_ORDER :
    key === 'priority' ? PRIORITY_ORDER :
                         EXECUTOR_ORDER;
  return order
    .filter((k) => buckets.has(k))
    .map((k) => ({
      id: k,
      label: labelFor(key, k),
      tasks: buckets.get(k) ?? [],
    }));
}

function labelFor(_key: GroupKey, value: string): string {
  const pretty = value.replace(/_/g, ' ');
  const cap = pretty.charAt(0).toUpperCase() + pretty.slice(1);
  return cap;
}

function cadenceLabel(k: string): string {
  switch (k) {
    case 'cron':            return 'Custom cron';
    case 'preset':          return 'Preset schedule';
    case 'one_shot':        return 'One-shot';
    case 'event_triggered': return 'Event-triggered';
    default:                return 'Unscheduled';
  }
}
