/**
 * MarkdownSplitPane - Horizontal split layout with resizable divider
 * Shows editor on left, preview on right
 */

import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface MarkdownSplitPaneProps {
  left: ReactNode;
  right: ReactNode;
  splitPosition: number;
  onSplitChange: (position: number) => void;
  className?: string;
}

const MIN_PANE_PERCENT = 20;
const MAX_PANE_PERCENT = 80;
const DEFAULT_SPLIT = 50;

export function MarkdownSplitPane({
  left,
  right,
  splitPosition,
  onSplitChange,
  className = '',
}: MarkdownSplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnimating, setIsAnimating] = useState(true);

  // Trigger animation on mount, disable after transition completes
  useEffect(() => {
    const timer = setTimeout(() => setIsAnimating(false), 300);
    return () => clearTimeout(timer);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDoubleClick = useCallback(() => {
    onSplitChange(DEFAULT_SPLIT);
  }, [onSplitChange]);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const newPosition = ((e.clientX - rect.left) / rect.width) * 100;
      const clampedPosition = Math.max(MIN_PANE_PERCENT, Math.min(MAX_PANE_PERCENT, newPosition));
      onSplitChange(clampedPosition);
    },
    [isDragging, onSplitChange]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Apply transition only during animation and not while dragging
  const paneTransitionClass = isAnimating && !isDragging ? 'split-pane-animated' : '';

  return (
    <div ref={containerRef} className={cn('flex h-full', className)}>
      <div
        className={cn('overflow-hidden', paneTransitionClass)}
        style={{ width: `${splitPosition}%` }}
      >
        {left}
      </div>

      <div
        className={cn('split-divider', isDragging && 'dragging')}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
      >
        <div className="split-divider-grip">
          <span />
          <span />
          <span />
        </div>
      </div>

      <div
        className={cn('overflow-hidden', paneTransitionClass)}
        style={{ width: `${100 - splitPosition}%` }}
      >
        {right}
      </div>
    </div>
  );
}
