/**
 * BranchSelector — popover to view and switch branches
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { FC } from 'react';
import { GitBranch, CaretDown } from '@phosphor-icons/react';
import { useGitStore } from '@/stores/gitStore';
import { cn } from '@/lib/utils';

export const BranchSelector: FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const currentBranch = useGitStore((s) => s.currentBranch);
  const repoStatus = useGitStore((s) => s.repoStatus);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  // Don't render when there's no git repo (after all hooks)
  if (!repoStatus) return null;

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={handleToggle}
        className={cn(
          'flex items-center gap-1.5 h-7 px-2 rounded-lg',
          'text-xs text-muted-foreground',
          'hover:bg-muted/60 hover:text-foreground',
          'active:scale-[0.97] transition-all duration-200',
        )}
        title="Branch"
      >
        <GitBranch className="w-3.5 h-3.5" weight="bold" />
        <span className="truncate max-w-[120px]">{currentBranch || 'main'}</span>
        <CaretDown className="w-3 h-3 opacity-50" />
      </button>

      {isOpen && (
        <div
          className={cn(
            'absolute top-full left-0 mt-1 w-[200px] z-50',
            'bg-card/95 backdrop-blur-md rounded-[12px] p-1.5',
            'shadow-[0_8px_32px_-8px_rgba(0,0,0,0.3)]',
            'animate-in fade-in slide-in-from-top-2 duration-150',
          )}
        >
          <div className="px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">
            Local Branches
          </div>
          <button
            className={cn(
              'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs',
              'bg-primary/10 text-foreground',
            )}
          >
            <GitBranch className="w-3.5 h-3.5 text-primary" weight="bold" />
            {currentBranch || 'main'}
          </button>
        </div>
      )}
    </div>
  );
};
