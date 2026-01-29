/**
 * CommandPalette - Glass morphism command palette (Cmd+K)
 * Provides quick access to files, commands, and settings
 */

import { useEffect, useRef, useCallback } from 'react';
import { Search, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useCommandPalette } from './useCommandPalette';
import { CommandItemComponent } from './CommandItem';

export function CommandPalette() {
  const {
    isOpen,
    close,
    query,
    setQuery,
    filteredItems,
    selectedIndex,
    setSelectedIndex,
    executeSelected,
    moveUp,
    moveDown,
  } = useCommandPalette();

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure DOM is ready
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

      {/* Palette container */}
      <div
        className={cn(
          'relative w-full max-w-[600px] mx-4',
          'bg-bg-glass backdrop-blur-xl',
          'rounded-xl overflow-hidden',
          'shadow-[0_16px_70px_-15px_rgba(0,0,0,0.5)]',
          'border border-border-subtle',
          'animate-scale-in'
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
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
            placeholder="Search files, commands, settings..."
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
          <button
            onClick={close}
            className={cn(
              'p-1.5 rounded-md',
              'text-muted-foreground hover:text-foreground',
              'hover:bg-bg-surface-2',
              'transition-colors duration-100'
            )}
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results list */}
        <div
          ref={listRef}
          className="max-h-[400px] overflow-y-auto"
          role="listbox"
        >
          {filteredItems.length === 0 ? (
            <div className="px-4 py-8 text-center text-muted-foreground">
              <p className="text-sm">No results found</p>
              <p className="text-xs mt-1">Try a different search term</p>
            </div>
          ) : (
            filteredItems.map((item, index) => (
              <CommandItemComponent
                key={item.id}
                ref={index === selectedIndex ? selectedRef : undefined}
                item={item}
                isSelected={index === selectedIndex}
                onClick={() => {
                  setSelectedIndex(index);
                  executeSelected();
                }}
                onMouseEnter={() => setSelectedIndex(index)}
              />
            ))
          )}
        </div>

        {/* Footer with hints */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-border-subtle bg-bg-surface-1/50">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-bg-surface-2 font-mono text-[10px]">↑↓</kbd>
              <span>navigate</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-bg-surface-2 font-mono text-[10px]">↵</kbd>
              <span>select</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 rounded bg-bg-surface-2 font-mono text-[10px]">esc</kbd>
              <span>close</span>
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            {filteredItems.length} result{filteredItems.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
