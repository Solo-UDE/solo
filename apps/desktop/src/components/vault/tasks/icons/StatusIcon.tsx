import type { FC, SVGProps } from 'react';
import type { TaskStatus } from '@/bindings/TaskStatus';

/**
 * Status glyphs. Port of Circle's `mock-data/status.tsx`, re-keyed to Solo's
 * `TaskStatus` enum. Colors sourced from Circle's palette (Linear-inspired).
 */

export const STATUS_COLOR: Record<TaskStatus, string> = {
  suggested: '#ec4899',    // pink — planner drafts (dashed)
  queued: '#a3a3a3',       // neutral grey — todo
  running: '#facc15',      // amber — active work
  needs_review: '#22c55e', // green — awaiting review
  done: '#8b5cf6',         // purple — completed
  failed: '#ef4444',       // red — failed
  archived: '#64748b',     // slate — archived
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  suggested: 'Suggested',
  queued: 'Queued',
  running: 'Running',
  needs_review: 'Needs Review',
  done: 'Done',
  failed: 'Failed',
  archived: 'Archived',
};

export const STATUS_ORDER: TaskStatus[] = [
  'suggested',
  'queued',
  'running',
  'needs_review',
  'done',
  'failed',
  'archived',
];

interface SvgWrapperProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

const Svg: FC<SvgWrapperProps> = ({ size = 14, children, ...rest }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 14 14"
    fill="none"
    aria-hidden="true"
    {...rest}
  >
    {children}
  </svg>
);

// --- individual glyphs --------------------------------------------------

const SuggestedGlyph: FC<SvgWrapperProps> = (p) => (
  <Svg {...p}>
    <circle
      cx="7"
      cy="7"
      r="6"
      stroke={STATUS_COLOR.suggested}
      strokeWidth="2"
      strokeDasharray="1.4 1.74"
      strokeDashoffset="0.65"
    />
  </Svg>
);

const QueuedGlyph: FC<SvgWrapperProps> = (p) => (
  <Svg {...p}>
    <circle
      cx="7"
      cy="7"
      r="6"
      stroke={STATUS_COLOR.queued}
      strokeWidth="2"
      strokeDasharray="3.14 0"
      strokeDashoffset="-0.7"
    />
  </Svg>
);

const RunningGlyph: FC<SvgWrapperProps> = (p) => (
  <Svg {...p}>
    <circle
      cx="7"
      cy="7"
      r="6"
      stroke={STATUS_COLOR.running}
      strokeWidth="2"
      strokeDasharray="3.14 0"
      strokeDashoffset="-0.7"
    />
    <circle
      cx="7"
      cy="7"
      r="2"
      stroke={STATUS_COLOR.running}
      strokeWidth="4"
      strokeDasharray="6.25 100"
      transform="rotate(-90 7 7)"
    />
  </Svg>
);

const NeedsReviewGlyph: FC<SvgWrapperProps> = (p) => (
  <Svg {...p}>
    <circle
      cx="7"
      cy="7"
      r="6"
      stroke={STATUS_COLOR.needs_review}
      strokeWidth="2"
      strokeDasharray="3.14 0"
      strokeDashoffset="-0.7"
    />
    <circle
      cx="7"
      cy="7"
      r="2"
      stroke={STATUS_COLOR.needs_review}
      strokeWidth="4"
      strokeDasharray="10.42 100"
      transform="rotate(-90 7 7)"
    />
  </Svg>
);

const DoneGlyph: FC<SvgWrapperProps> = (p) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="6" fill={STATUS_COLOR.done} />
    <path
      d="M4.5 7L6.5 9L9.5 5"
      stroke="white"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

const FailedGlyph: FC<SvgWrapperProps> = (p) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="6" fill={STATUS_COLOR.failed} />
    <path
      d="M4.8 4.8L9.2 9.2M9.2 4.8L4.8 9.2"
      stroke="white"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </Svg>
);

const ArchivedGlyph: FC<SvgWrapperProps> = (p) => (
  <Svg {...p}>
    <circle
      cx="7"
      cy="7"
      r="6"
      stroke={STATUS_COLOR.archived}
      strokeWidth="2"
      strokeDasharray="1.4 1.74"
    />
    <path
      d="M4.5 7L9.5 7"
      stroke={STATUS_COLOR.archived}
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </Svg>
);

// --- public API ---------------------------------------------------------

export const StatusIcon: FC<{ status: TaskStatus; size?: number; className?: string }> = ({
  status,
  size,
  className,
}) => {
  switch (status) {
    case 'suggested':
      return <SuggestedGlyph size={size} className={className} />;
    case 'queued':
      return <QueuedGlyph size={size} className={className} />;
    case 'running':
      return <RunningGlyph size={size} className={className} />;
    case 'needs_review':
      return <NeedsReviewGlyph size={size} className={className} />;
    case 'done':
      return <DoneGlyph size={size} className={className} />;
    case 'failed':
      return <FailedGlyph size={size} className={className} />;
    case 'archived':
      return <ArchivedGlyph size={size} className={className} />;
  }
};
