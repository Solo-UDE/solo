/**
 * CollapsibleSection - Vertically stacked expandable section for the content sidebar.
 * Uses pure motion.js for spring-animated height transitions.
 * Codex-style rounded container with subtle shadow when expanded.
 */

import { useState, type FC, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronRightIcon } from '@radix-ui/react-icons';
import { cn } from '@/lib/utils';

interface CollapsibleSectionProps {
  title: string;
  icon?: FC<{ className?: string }>;
  defaultOpen?: boolean;
  /** Action buttons rendered in the section header */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export const CollapsibleSection: FC<CollapsibleSectionProps> = ({
  title,
  icon: Icon,
  defaultOpen = true,
  actions,
  children,
  className,
}) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={cn('flex flex-col min-h-0', open && 'flex-1', className)}>
      {/* Section header */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((prev) => !prev);
          }
        }}
        className={cn(
          'group flex items-center gap-1.5 h-7 px-2 w-full cursor-pointer',
          'text-xs font-medium text-muted-foreground/80',
          'hover:text-foreground hover:bg-muted/30',
          'transition-colors duration-150',
          'select-none',
        )}
      >
        <motion.div
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          className="shrink-0"
        >
          <ChevronRightIcon className="w-3 h-3" />
        </motion.div>

        {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}

        <span className="uppercase tracking-wider text-[10px] flex-1 text-left">
          {title}
        </span>

        {/* Action buttons (stop propagation to prevent toggle) */}
        {actions && (
          <div
            className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {actions}
          </div>
        )}
      </div>

      {/* Animated content */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
            className="overflow-hidden flex-1 min-h-0"
          >
            <div className="flex flex-col min-h-0 h-full">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
