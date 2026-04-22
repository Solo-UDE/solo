import type { FC } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Label } from '@/bindings/Label';

interface Props {
  label: Label;
  /** When set, renders an X button that invokes the callback. */
  onRemove?: () => void;
  className?: string;
}

/**
 * Pill badge for a Label. The hex color powers the dot; the pill itself is
 * neutral background — keeps badges readable against both light and dark
 * surfaces without per-label color mixing.
 */
export const LabelBadge: FC<Props> = ({ label, onRemove, className }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[10.5px] font-medium text-foreground',
      className,
    )}
  >
    <span
      aria-hidden="true"
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: label.color }}
    />
    <span className="truncate max-w-[120px]">{label.name}</span>
    {onRemove && (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label={`Remove ${label.name}`}
        className="grid h-3 w-3 place-items-center rounded-sm text-muted-foreground/60 hover:text-red-500"
      >
        <X className="h-2.5 w-2.5" />
      </button>
    )}
  </span>
);
