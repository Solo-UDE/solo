/**
 * Composite skeleton layouts for common loading states.
 * Built on top of the @solo/ui Skeleton primitive.
 */

import type { FC } from 'react';
import { Skeleton } from '@solo/ui';
import { cn } from '@/lib/utils';

/* ── Code skeleton — mimics lines of code with varying widths ── */

interface CodeSkeletonProps {
  /** Number of skeleton lines. Default: 12 */
  lines?: number;
  /** Show line number gutter. Default: true */
  gutter?: boolean;
  className?: string;
}

/** Deterministic pseudo-random widths so layout doesn't shift between renders */
const CODE_WIDTHS = [72, 55, 88, 40, 65, 92, 48, 78, 35, 60, 85, 50, 70, 45, 82, 58];

export const CodeSkeleton: FC<CodeSkeletonProps> = ({
  lines = 12,
  gutter = true,
  className,
}) => (
  <div className={cn('flex flex-col gap-2.5 p-4', className)} role="status" aria-label="Loading content">
    {Array.from({ length: lines }, (_, i) => (
      <div key={i} className="flex items-center gap-3">
        {gutter && (
          <Skeleton className="h-3 w-5 shrink-0 rounded" />
        )}
        <Skeleton
          shimmer
          className="h-3 rounded"
          style={{ width: `${CODE_WIDTHS[i % CODE_WIDTHS.length]}%` }}
        />
      </div>
    ))}
  </div>
);

/* ── List skeleton — mimics a vertical list with icon + text rows ── */

interface ListSkeletonProps {
  /** Number of skeleton rows. Default: 4 */
  rows?: number;
  /** Show circular icon placeholder. Default: true */
  icon?: boolean;
  className?: string;
}

export const ListSkeleton: FC<ListSkeletonProps> = ({
  rows = 4,
  icon = true,
  className,
}) => (
  <div className={cn('flex flex-col gap-2 p-2', className)} role="status" aria-label="Loading list">
    {Array.from({ length: rows }, (_, i) => (
      <div key={i} className="flex items-center gap-2.5 px-2 py-1.5">
        {icon && (
          <Skeleton className="h-4 w-4 rounded shrink-0" />
        )}
        <div className="flex-1 space-y-1.5">
          <Skeleton
            shimmer
            className="h-3 rounded"
            style={{ width: `${60 + (i * 13) % 30}%` }}
          />
        </div>
      </div>
    ))}
  </div>
);
