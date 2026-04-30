import type { Task } from '@/lib/tauri/tasks';
import type { Label } from '@/bindings/Label';
import type { Project } from '@/bindings/Project';
import type { Cycle } from '@/bindings/Cycle';

export type GroupKey =
  | 'status' | 'priority' | 'executor' | 'cadence'
  | 'context_anchor' | 'agent_fingerprint' | 'last_run_health'
  | 'label' | 'project' | 'cycle'
  | 'none';

export interface TaskGroup {
  readonly id: string;
  readonly label: string;
  readonly tasks: readonly Task[];
}

/**
 * Optional lookup context passed when grouping by label / project / cycle.
 * Each map is keyed by id; missing keys fall back to the raw id as label.
 */
export interface GroupingContext {
  readonly labels?: Map<string, Label>;
  readonly projects?: Map<string, Project>;
  readonly cycles?: Map<string, Cycle>;
}

export const GROUPING_LABELS: Record<GroupKey, string> = {
  status:            'Status',
  priority:          'Priority',
  executor:          'Executor',
  cadence:           'Cadence',
  context_anchor:    'Context anchor',
  agent_fingerprint: 'Agent fingerprint',
  last_run_health:   'Last-run health',
  label:             'Label',
  project:           'Project',
  cycle:             'Cycle',
  none:              'No grouping',
};

const STATUS_ORDER: Task['status'][] = [
  'suggested', 'queued', 'running', 'needs_review', 'done', 'failed', 'archived',
];
const PRIORITY_ORDER: Task['priority'][] = ['urgent', 'high', 'medium', 'low'];
const EXECUTOR_ORDER: Task['executor'][] = ['agent', 'manual'];

export function groupTasks(
  tasks: readonly Task[],
  key: GroupKey,
  ctx: GroupingContext = {},
): TaskGroup[] {
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

  if (key === 'context_anchor') {
    const buckets = new Map<string, Task[]>();
    for (const t of tasks) {
      // Each task may have N anchors; it appears in EACH bucket (a task can be in multiple groups here).
      if (!t.context_anchors || t.context_anchors.length === 0) {
        const list = buckets.get('none') ?? [];
        list.push(t);
        buckets.set('none', list);
      } else {
        for (const anchor of t.context_anchors) {
          const k = `${anchor.kind}:${anchor.id}`;
          const list = buckets.get(k) ?? [];
          list.push(t);
          buckets.set(k, list);
        }
      }
    }
    return Array.from(buckets.entries()).map(([id, tasks]) => ({
      id,
      label: id === 'none' ? 'No anchor' : id,
      tasks,
    }));
  }

  if (key === 'agent_fingerprint') {
    const buckets = new Map<string, Task[]>();
    for (const t of tasks) {
      const k = t.agent_config
        ? `${t.agent_config.model ?? 'default'} · ${t.agent_config.execution_location}`
        : 'no-config';
      const list = buckets.get(k) ?? [];
      list.push(t);
      buckets.set(k, list);
    }
    return Array.from(buckets.entries()).map(([id, tasks]) => ({
      id, label: id === 'no-config' ? 'Manual / no config' : id, tasks,
    }));
  }

  if (key === 'last_run_health') {
    const buckets = new Map<string, Task[]>();
    const now = Date.now();
    const bucketFor = (t: Task): string => {
      if (!t.runs || t.runs.length === 0) return 'never-run';
      const last = t.runs[0]; // runs are sorted newest first
      if (last.outcome === 'failed') return 'failed';
      if (last.outcome === 'cancelled') return 'cancelled';
      if (last.outcome === 'running') return 'running';
      // Succeeded — check if scheduled and overdue
      if (t.schedule) {
        const nextFire = t.schedule.kind === 'cron' ? Number(t.schedule.data.next_fire)
          : t.schedule.kind === 'preset' ? Number(t.schedule.data.next_fire)
          : null;
        if (nextFire && nextFire < now - 86_400_000) return 'overdue'; // >1 day overdue
      }
      return 'succeeded';
    };
    for (const t of tasks) {
      const k = bucketFor(t);
      const list = buckets.get(k) ?? [];
      list.push(t);
      buckets.set(k, list);
    }
    const order = ['failed', 'overdue', 'running', 'never-run', 'succeeded', 'cancelled'];
    const labels: Record<string, string> = {
      failed: 'Failed',
      overdue: 'Overdue',
      running: 'Running',
      'never-run': 'Never run',
      succeeded: 'Succeeded',
      cancelled: 'Cancelled',
    };
    return order.filter((k) => buckets.has(k))
      .map((k) => ({ id: k, label: labels[k], tasks: buckets.get(k) ?? [] }));
  }

  if (key === 'label') {
    // A task with N labels appears in N groups; no-label tasks go to "none".
    const buckets = new Map<string, Task[]>();
    for (const t of tasks) {
      if (t.label_ids.length === 0) {
        const list = buckets.get('none') ?? [];
        list.push(t);
        buckets.set('none', list);
      } else {
        for (const lid of t.label_ids) {
          const list = buckets.get(lid) ?? [];
          list.push(t);
          buckets.set(lid, list);
        }
      }
    }
    return Array.from(buckets.entries()).map(([id, tasks]) => ({
      id,
      label: id === 'none' ? 'No label' : (ctx.labels?.get(id)?.name ?? id),
      tasks,
    }));
  }

  if (key === 'project') {
    const buckets = new Map<string, Task[]>();
    for (const t of tasks) {
      const k = t.project_id ?? 'none';
      const list = buckets.get(k) ?? [];
      list.push(t);
      buckets.set(k, list);
    }
    return Array.from(buckets.entries()).map(([id, tasks]) => ({
      id,
      label: id === 'none' ? 'No project' : (ctx.projects?.get(id)?.name ?? id),
      tasks,
    }));
  }

  if (key === 'cycle') {
    const buckets = new Map<string, Task[]>();
    for (const t of tasks) {
      const k = t.cycle_id ?? 'none';
      const list = buckets.get(k) ?? [];
      list.push(t);
      buckets.set(k, list);
    }
    return Array.from(buckets.entries()).map(([id, tasks]) => ({
      id,
      label: id === 'none' ? 'No cycle' : (ctx.cycles?.get(id)?.name ?? id),
      tasks,
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
