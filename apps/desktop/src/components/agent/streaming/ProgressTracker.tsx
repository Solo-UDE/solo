import { ProgressTrackerItem } from './ProgressTrackerItem';

import type { ProgressPhase } from '@/lib/deriveProgressPhases';
import type { FC } from 'react';

interface ProgressTrackerProps {
  phases: ProgressPhase[];
  className?: string;
}

export const ProgressTracker: FC<ProgressTrackerProps> = ({ phases, className = '' }) => {
  return (
    <div role="status" aria-label="Agent progress" className={className}>
      {phases.map((phase, i) => (
        <ProgressTrackerItem
          key={phase.id}
          label={phase.label}
          status={phase.status}
          isFirst={i === 0}
          preview={phase.preview}
        />
      ))}
    </div>
  );
};
