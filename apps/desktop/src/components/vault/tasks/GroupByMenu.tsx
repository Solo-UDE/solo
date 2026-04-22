import type { FC } from 'react';
import { cn } from '@/lib/utils';
import type { GroupKey } from './groupings';
import { GROUPING_LABELS } from './groupings';

interface Props {
  readonly value: GroupKey;
  readonly onChange: (k: GroupKey) => void;
}

const OPTIONS: GroupKey[] = ['status', 'priority', 'executor', 'none'];

export const GroupByMenu: FC<Props> = ({ value, onChange }) => (
  <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
    <span>Group by</span>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as GroupKey)}
      className={cn(
        'rounded-md border border-border/60 bg-background px-2 py-1 text-[12px]',
        'text-foreground focus:outline-none focus:ring-1 focus:ring-border',
      )}
    >
      {OPTIONS.map((k) => (
        <option key={k} value={k}>{GROUPING_LABELS[k]}</option>
      ))}
    </select>
  </label>
);
