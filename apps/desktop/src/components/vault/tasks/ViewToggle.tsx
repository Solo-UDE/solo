import type { FC } from 'react';
import { List, Columns3, CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ViewKind = 'list' | 'kanban' | 'calendar';

interface Props {
  readonly value: ViewKind;
  readonly onChange: (v: ViewKind) => void;
}

export const ViewToggle: FC<Props> = ({ value, onChange }) => (
  <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-card p-0.5">
    {([
      { k: 'list' as const,     Icon: List,         title: 'List view' },
      { k: 'kanban' as const,   Icon: Columns3,     title: 'Kanban view' },
      { k: 'calendar' as const, Icon: CalendarDays, title: 'Calendar view' },
    ]).map(({ k, Icon, title }) => (
      <button
        key={k}
        type="button"
        title={title}
        onClick={() => onChange(k)}
        className={cn(
          'grid h-6 w-6 place-items-center rounded text-muted-foreground',
          value === k ? 'bg-muted text-foreground' : 'hover:text-foreground',
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </button>
    ))}
  </div>
);
