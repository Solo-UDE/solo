/**
 * QuickSwitcher - Fast file switcher (Cmd+P)
 * Glass morphism design matching command palette
 */

import { useEffect, useRef, useCallback } from 'react';
import { FileText, Clock, Loader2, Search } from 'lucide-react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useQuickSwitcher } from './useQuickSwitcher';

export function QuickSwitcher() {
  const {
    isOpen,
    close,
    query,
    setQuery,
    items,
    selectedIndex,
    setSelectedIndex,
    executeSelected,
    moveUp,
    moveDown,
    isLoading,
  } = useQuickSwitcher();

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen]);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedRef.current && listRef.current) {
      selectedRef.current.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [selectedIndex]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          moveUp();
          break;
        case 'ArrowDown':
          e.preventDefault();
          moveDown();
          break;
        case 'Enter':
          e.preventDefault();
          executeSelected();
          break;
        case 'Escape':
          e.preventDefault();
          close();
          break;
        case 'Tab':
          e.preventDefault();
          if (e.shiftKey) {
            moveUp();
          } else {
            moveDown();
          }
          break;
      }
    },
    [moveUp, moveDown, executeSelected, close]
  );

  // Click outside to close
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        close();
      }
    },
    [close]
  );

  if (!isOpen) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={handleBackdropClick}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in-up" />

      {/* Switcher container */}
      <div
        className={cn(
          'relative w-full max-w-[550px] mx-4',
          'bg-bg-glass backdrop-blur-xl',
          'rounded-xl overflow-hidden',
          'shadow-[0_16px_70px_-15px_rgba(0,0,0,0.5)]',
          'border border-border-subtle',
          'animate-scale-in'
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Quick file switcher"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-subtle">
          <Search className="w-5 h-5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type to search files..."
            className={cn(
              'flex-1 bg-transparent text-foreground text-lg',
              'placeholder:text-muted-foreground/50',
              'focus:outline-none'
            )}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          {isLoading && (
            <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
          )}
        </div>

        {/* Results list */}
        <div
          ref={listRef}
          className="max-h-[350px] overflow-y-auto"
          role="listbox"
        >
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-muted-foreground">
              <p className="text-sm">
                {isLoading ? 'Loading files...' : 'No files found'}
              </p>
            </div>
          ) : (
            items.map((item, index) => (
              <div
                key={item.id}
                ref={index === selectedIndex ? selectedRef : undefined}
                role="option"
                aria-selected={index === selectedIndex}
                className={cn(
                  'flex items-center gap-3 px-4 py-2.5 cursor-pointer',
                  'transition-colors duration-100',
                  index === selectedIndex
                    ? 'bg-bg-surface-3 text-foreground'
                    : 'text-muted-foreground hover:bg-bg-surface-2'
                )}
                onClick={() => {
                  setSelectedIndex(index);
                  executeSelected();
                }}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                {/* Icon */}
                <span className={cn(
                  'shrink-0',
                  index === selectedIndex ? 'text-foreground' : 'text-muted-foreground'
                )}>
                  {item.isRecent ? (
                    <Clock className="w-4 h-4" />
                  ) : (
                    <FileText className="w-4 h-4" />
                  )}
                </span>

                {/* File name and path */}
                <div className="flex-1 min-w-0">
                  <div className={cn(
                    'text-sm truncate',
                    index === selectedIndex && 'text-foreground'
                  )}>
                    {item.name}
                  </div>
                  <div className="text-xs text-muted-foreground/70 truncate">
                    {item.path}
                  </div>
                </div>

                {/* Recent badge */}
                {item.isRecent && (
                  <span className="text-xs text-muted-foreground">recent</span>
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-border-subtle bg-bg-surface-1/50">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-bg-surface-2 font-mono text-[10px]">↑↓</kbd>
              <span>navigate</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-bg-surface-2 font-mono text-[10px]">↵</kbd>
              <span>open</span>
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            {items.length} file{items.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
