import { CheckIcon } from '@radix-ui/react-icons';
import { Loader2 } from 'lucide-react';
import { AgentAnimatedDots } from './AgentAnimatedDots';

import type { FC } from 'react';

interface ProgressTrackerItemProps {
  label: string;
  status: 'active' | 'completed';
  isFirst: boolean;
  preview?: string;
}

export const ProgressTrackerItem: FC<ProgressTrackerItemProps> = ({ label, status, isFirst, preview }) => {
  return (
    <div
      className="flex min-w-0 flex-col"
      style={{
        animation: 'progress-fade-in-up 260ms cubic-bezier(0.2, 0, 0, 1) both',
        animationDelay: isFirst ? '0ms' : '400ms',
      }}
    >
      {/* Connector line between items */}
      {!isFirst && (
        <svg
          width="2"
          height="24"
          viewBox="0 0 2 24"
          className="ml-[9px] text-primary/35"
          aria-hidden="true"
          style={{ animation: 'draw-down 360ms cubic-bezier(0.2, 0, 0, 1) both' }}
        >
          <line
            x1="1" y1="0" x2="1" y2="24"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="4 4"
          />
        </svg>
      )}

      {/* Status row */}
      <div className="flex min-w-0 items-start gap-2">
        {status === 'completed' ? (
          <div
            className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-primary text-primary shadow-[0_0_0_3px_color-mix(in_oklch,var(--primary)_8%,transparent)]"
            style={{ animation: 'spring-pop 320ms cubic-bezier(0.2, 0, 0, 1) both' }}
          >
            <CheckIcon width={12} height={12} />
          </div>
        ) : (
          <div
            className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-primary/70 text-primary shadow-[0_0_0_3px_color-mix(in_oklch,var(--primary)_7%,transparent)]"
            style={{ animation: 'progress-scale-in 180ms cubic-bezier(0.2, 0, 0, 1) both' }}
          >
            <Loader2 className="h-3 w-3 animate-spin" />
          </div>
        )}

        <div className="flex min-w-0 flex-col">
          <span
            className="truncate text-[13px] font-semibold leading-6 text-primary transition-colors"
          >
            {label}
            {status === 'active' && <AgentAnimatedDots />}
          </span>
          {preview ? (
            <span
              className="mt-0.5 max-w-[min(42rem,70vw)] truncate font-mono text-[12px] leading-5 text-muted-foreground/58"
              title={preview}
            >
              {preview}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
};
