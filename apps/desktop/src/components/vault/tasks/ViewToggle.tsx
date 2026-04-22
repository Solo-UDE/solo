import type { FC } from 'react';
import { List, Columns3, CalendarDays } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

export type ViewKind = 'list' | 'kanban' | 'calendar';

interface Props {
  readonly value: ViewKind;
  readonly onChange: (v: ViewKind) => void;
}

const VIEWS = [
  { k: 'list' as const, Icon: List, title: 'List view' },
  { k: 'kanban' as const, Icon: Columns3, title: 'Kanban view' },
  { k: 'calendar' as const, Icon: CalendarDays, title: 'Calendar view' },
];

/**
 * Segmented control for switching views. Circle-style: animated layout pill
 * highlights the active view so switching feels crisp.
 */
export const ViewToggle: FC<Props> = ({ value, onChange }) => (
  <div className="relative flex items-center gap-0.5 rounded-md border border-border/60 bg-card p-0.5">
    {VIEWS.map(({ k, Icon, title }) => (
      <button
        key={k}
        type="button"
        title={title}
        onClick={() => onChange(k)}
        className={cn(
          'relative grid h-6 w-6 place-items-center rounded text-muted-foreground transition-colors',
          value === k ? 'text-foreground' : 'hover:text-foreground',
        )}
      >
        {value === k && (
          <motion.span
            layoutId="view-toggle-active"
            className="absolute inset-0 rounded bg-muted"
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
          />
        )}
        <Icon className="relative h-3.5 w-3.5" />
      </button>
    ))}
  </div>
);
