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
  isOpen?: boolean;
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
  isOpen = true,
  className = '',
}: MarkdownSplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  // Start at 100 (fully closed) and animate to target position
  const [animatedPosition, setAnimatedPosition] = useState(100);
  const initializedRef = useRef(false);

  // Animate on open/close: transition between 100% (editor full) and splitPosition
  useEffect(() => {
    if (!isOpen) {
      // Closing: animate to 100% (full editor)
      if (initializedRef.current) {
        setIsAnimating(true);
        setAnimatedPosition(100);
        const timer = setTimeout(() => setIsAnimating(false), 300);
        return () => clearTimeout(timer);
      }
      return;
    }

    if (!initializedRef.current) {
      // First render: start animation from closed state
      initializedRef.current = true;
      setIsAnimating(true);
      // Use rAF to ensure the initial 100% position is rendered before animating
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setAnimatedPosition(splitPosition);
        });
      });
      const timer = setTimeout(() => setIsAnimating(false), 300);
      return () => clearTimeout(timer);
    } else {
      // Subsequent updates: animate to new position
      setIsAnimating(true);
      setAnimatedPosition(splitPosition);
      const timer = setTimeout(() => setIsAnimating(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen, splitPosition]);

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
    // Sync animated position with actual position after drag ends
    setAnimatedPosition(splitPosition);
  }, [splitPosition]);

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

  // Use animated position for rendering, but update the store with the actual position during drag
  const displayPosition = isDragging ? splitPosition : animatedPosition;

  const showPreview = isOpen || isAnimating;

  return (
    <div ref={containerRef} className={cn('flex h-full', className)}>
      <div
        className={cn('overflow-hidden', paneTransitionClass)}
        style={{ width: `${displayPosition}%` }}
      >
        {left}
      </div>

      {showPreview && (
        <>
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
            style={{ width: `${100 - displayPosition}%` }}
          >
            {right}
          </div>
        </>
      )}
    </div>
  );
}
