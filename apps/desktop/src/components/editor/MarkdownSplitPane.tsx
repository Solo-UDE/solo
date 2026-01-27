/**
 * MarkdownSplitPane - Horizontal split layout with resizable divider
 * Shows editor on left, preview on right
 */

import { useState, useCallback, useRef, useEffect, type ReactNode } from 'react';

interface MarkdownSplitPaneProps {
  left: ReactNode;
  right: ReactNode;
  splitPosition: number;
  onSplitChange: (position: number) => void;
  className?: string;
}

const MIN_PANE_PERCENT = 20;
const MAX_PANE_PERCENT = 80;

export function MarkdownSplitPane({
  left,
  right,
  splitPosition,
  onSplitChange,
  className = '',
}: MarkdownSplitPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

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

  return (
    <div ref={containerRef} className={`flex h-full ${className}`}>
      <div className="overflow-hidden" style={{ width: `${splitPosition}%` }}>
        {left}
      </div>

      <div
        className={`split-divider ${isDragging ? 'dragging' : ''}`}
        onMouseDown={handleMouseDown}
      >
        <div className="split-divider-line" />
      </div>

      <div className="overflow-hidden" style={{ width: `${100 - splitPosition}%` }}>
        {right}
      </div>
    </div>
  );
}
