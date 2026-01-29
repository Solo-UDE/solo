/**
 * ActivityBarItem - Individual icon button in the activity bar
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface ActivityBarItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Icon to display */
  icon: ReactNode;
  /** Label for accessibility and tooltip */
  label: string;
  /** Keyboard shortcut hint */
  shortcut?: string;
  /** Whether this item is currently active */
  isActive?: boolean;
  /** Position in the bar (affects active indicator) */
  position?: 'top' | 'bottom';
}

export const ActivityBarItem = forwardRef<HTMLButtonElement, ActivityBarItemProps>(
  ({ icon, label, shortcut, isActive, position = 'top', className, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'relative flex items-center justify-center',
          'w-12 h-12',
          'text-activity-bar-foreground',
          'focus-visible:outline-none',
          isActive && 'text-activity-bar-active',
          className
        )}
        title={shortcut ? `${label} (${shortcut})` : label}
        aria-label={label}
        aria-pressed={isActive}
        {...props}
      >
        {/* Active indicator - left border */}
        {isActive && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-primary rounded-r-full" />
        )}

        {/* Icon */}
        <span className="w-5 h-5 flex items-center justify-center">
          {icon}
        </span>
      </button>
    );
  }
);

ActivityBarItem.displayName = 'ActivityBarItem';
