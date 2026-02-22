import { Check } from '@phosphor-icons/react';
import { AgentAnimatedDots } from './AgentAnimatedDots';
import { AgentLoadingGrid } from './AgentLoadingGrid';

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
      className="flex flex-col"
      style={{
        animation: 'progress-fade-in-up 300ms ease both',
        animationDelay: isFirst ? '0ms' : '400ms',
      }}
    >
      {/* Connector line between items */}
      {!isFirst && (
        <svg
          width="2"
          height="24"
          viewBox="0 0 2 24"
          className="ml-[9px] text-primary"
          aria-hidden="true"
          style={{ animation: 'draw-down 400ms ease both' }}
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
      <div className="flex items-center gap-2">
        {status === 'completed' ? (
          <div
            className="flex items-center justify-center w-[18px] h-[18px] rounded-full border border-primary"
            style={{ animation: 'spring-pop 400ms ease both' }}
          >
            <Check weight="bold" className="w-3 h-3 text-primary" />
          </div>
        ) : (
          <div
            className="flex items-center justify-center w-[18px] h-[18px]"
            style={{ animation: 'progress-scale-in 200ms ease both' }}
          >
            <AgentLoadingGrid />
          </div>
        )}

        <div className="flex flex-col">
          <span
            className={`text-sm font-medium transition-colors ${
              status === 'completed' ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            {label}
            {status === 'active' && <AgentAnimatedDots />}
          </span>
          {preview ? (
            <span className="text-[11px] text-muted-foreground/60 truncate max-w-[280px] font-mono mt-0.5">
              {preview}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
};
