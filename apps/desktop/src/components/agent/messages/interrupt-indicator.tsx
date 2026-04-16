import { CrossCircledIcon } from '@radix-ui/react-icons';

import type { FC } from 'react';

interface InterruptIndicatorProps {
  readonly onFeedback?: () => void;
}

export const InterruptIndicator: FC<InterruptIndicatorProps> = ({ onFeedback }) => {
  return (
    <div className="flex items-center gap-2 py-2 text-destructive/70">
      <CrossCircledIcon width={16} height={16} />

      {onFeedback ? (
        <button
          onClick={onFeedback}
          className="text-xs hover:text-destructive hover:underline transition-colors"
        >
          What can Solo do differently?
        </button>
      ) : (
        <span className="text-xs">Interrupted</span>
      )}

      <div className="flex-1 h-px bg-destructive/30" />
    </div>
  );
};
