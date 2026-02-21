import { CaretDown, CaretRight } from '@phosphor-icons/react';
import { useState } from 'react';

import { ProgressStep } from './progress-step';
import { AnimatedList } from '@/components/ui/animated-list';

import type { FC } from 'react';

export interface ProgressUpdate {
  step: number;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export interface ProgressUpdatesProps {
  updates: ProgressUpdate[];
  defaultExpanded?: boolean;
  className?: string;
}

export const ProgressUpdates: FC<ProgressUpdatesProps> = ({
  updates,
  defaultExpanded = true,
  className = '',
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const completedCount = updates.filter(
    (u) => u.status === 'completed'
  ).length;
  const totalCount = updates.length;

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Header */}
      <button
        onClick={() => {
          setIsExpanded(!isExpanded);
        }}
        className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors w-full"
      >
        {isExpanded ? (
          <CaretDown className="w-3 h-3" />
        ) : (
          <CaretRight className="w-3 h-3" />
        )}
        <span>
          Progress Updates ({completedCount}/{totalCount})
        </span>
      </button>

      {/* Progress Steps */}
      {isExpanded ? (
        <AnimatedList className="space-y-2 pl-2" stagger={0.04} slideY={4}>
          {updates.map((update) => (
            <ProgressStep
              key={update.step}
              step={update.step}
              description={update.description}
              status={update.status}
            />
          ))}
        </AnimatedList>
      ) : null}
    </div>
  );
};
