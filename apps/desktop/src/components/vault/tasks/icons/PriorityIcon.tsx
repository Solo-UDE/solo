import type { FC, SVGProps } from 'react';
import type { TaskPriority } from '@/bindings/TaskPriority';

/**
 * Priority glyphs. Port of Circle's `mock-data/priorities.tsx`, re-keyed to
 * Solo's `TaskPriority` enum. Bar-chart style for Low/Medium/High, solid
 * urgent badge for Urgent.
 */

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export const PRIORITY_ORDER: TaskPriority[] = ['urgent', 'high', 'medium', 'low'];

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

const LowGlyph: FC<IconProps> = ({ size = 16, ...rest }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-label="Low priority"
    role="img"
    {...rest}
  >
    <rect x="1.5" y="8" width="3" height="6" rx="1" />
    <rect x="6.5" y="5" width="3" height="9" rx="1" fillOpacity="0.4" />
    <rect x="11.5" y="2" width="3" height="12" rx="1" fillOpacity="0.4" />
  </svg>
);

const MediumGlyph: FC<IconProps> = ({ size = 16, ...rest }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-label="Medium priority"
    role="img"
    {...rest}
  >
    <rect x="1.5" y="8" width="3" height="6" rx="1" />
    <rect x="6.5" y="5" width="3" height="9" rx="1" />
    <rect x="11.5" y="2" width="3" height="12" rx="1" fillOpacity="0.4" />
  </svg>
);

const HighGlyph: FC<IconProps> = ({ size = 16, ...rest }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-label="High priority"
    role="img"
    {...rest}
  >
    <rect x="1.5" y="8" width="3" height="6" rx="1" />
    <rect x="6.5" y="5" width="3" height="9" rx="1" />
    <rect x="11.5" y="2" width="3" height="12" rx="1" />
  </svg>
);

const UrgentGlyph: FC<IconProps> = ({ size = 16, ...rest }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-label="Urgent priority"
    role="img"
    {...rest}
  >
    <path d="M3 1C1.91067 1 1 1.91067 1 3V13C1 14.0893 1.91067 15 3 15H13C14.0893 15 15 14.0893 15 13V3C15 1.91067 14.0893 1 13 1H3ZM7 4L9 4L8.75391 8.99836H7.25L7 4ZM9 11C9 11.5523 8.55228 12 8 12C7.44772 12 7 11.5523 7 11C7 10.4477 7.44772 10 8 10C8.55228 10 9 10.4477 9 11Z" />
  </svg>
);

export const PriorityIcon: FC<{ priority: TaskPriority; size?: number; className?: string }> = ({
  priority,
  size,
  className,
}) => {
  switch (priority) {
    case 'low':
      return <LowGlyph size={size} className={className} />;
    case 'medium':
      return <MediumGlyph size={size} className={className} />;
    case 'high':
      return <HighGlyph size={size} className={className} />;
    case 'urgent':
      return <UrgentGlyph size={size} className={className} />;
  }
};

export const PRIORITY_CLASSNAME: Record<TaskPriority, string> = {
  low: 'text-muted-foreground',
  medium: 'text-muted-foreground',
  high: 'text-foreground',
  urgent: 'text-red-500',
};
