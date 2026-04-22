import type { FC } from 'react';
import type { GroupKey } from './groupings';
import { GROUPING_LABELS } from './groupings';
import { SelectDropdown } from '@/components/settings/controls/SelectDropdown';

interface Props {
  readonly value: GroupKey;
  readonly onChange: (k: GroupKey) => void;
}

const OPTIONS: GroupKey[] = [
  'status', 'priority', 'executor', 'cadence',
  'context_anchor', 'agent_fingerprint', 'last_run_health',
  'none',
];

export const GroupByMenu: FC<Props> = ({ value, onChange }) => (
  <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
    <span>Group by</span>
    <SelectDropdown
      value={value}
      options={OPTIONS.map((k) => ({ label: GROUPING_LABELS[k], value: k }))}
      onChange={onChange}
    />
  </label>
);
