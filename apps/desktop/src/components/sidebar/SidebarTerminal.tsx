/**
 * SidebarTerminal — Terminal section rendered at the bottom of the sidebar.
 * Manages its own tab bar and terminal lifecycle, rendering TerminalView directly
 * (bypasses the mosaic panel system).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FC } from 'react';
import { Plus, TerminalWindow, X } from '@phosphor-icons/react';
import { TerminalView } from '@/components/terminal/TerminalView';
import { useTerminalStore } from '@/stores/terminalStore';
import { useUIStore } from '@/stores/uiStore';
import { useFileExplorerStore } from '@/stores/fileExplorerStore';
import { createTerminal, killTerminal } from '@/lib/tauri/terminal';
import { useInlineRename } from '@/hooks/useInlineRename';
import { TERMINAL_SECTION } from '@/lib/constants';
import { cn } from '@/lib/utils';

export const SidebarTerminal: FC = () => {
  const terminals = useTerminalStore((s) => s.terminals);
  const activeTerminalId = useTerminalStore((s) => s.activeTerminalId);
  const setActiveTerminal = useTerminalStore((s) => s.setActiveTerminal);
  const addTerminal = useTerminalStore((s) => s.addTerminal);
  const removeTerminal = useTerminalStore((s) => s.removeTerminal);
  const markExited = useTerminalStore((s) => s.markExited);
  const renameTerminal = useTerminalStore((s) => s.renameTerminal);
  const toggleTerminalPanel = useUIStore((s) => s.toggleTerminalPanel);

  const rename = useInlineRename((id, value) => renameTerminal(id, value));
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState<'none' | 'left' | 'right' | 'both'>('none');

  const updateScrollState = useCallback(() => {
    const el = tabsContainerRef.current;
    if (!el) return;
    const hasLeft = el.scrollLeft > 0;
    const hasRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setScrollState(
      hasLeft && hasRight ? 'both' : hasLeft ? 'left' : hasRight ? 'right' : 'none',
    );
  }, []);

  useEffect(() => {
    updateScrollState();
  }, [terminals.size, updateScrollState]);

  const handleNewTerminal = useCallback(() => {
    const cwd = useFileExplorerStore.getState().rootPath ?? undefined;
    createTerminal(cwd)
      .then(({ id, shell }) => {
        addTerminal(id, cwd, shell);
      })
      .catch((err) => {
        console.error('Failed to create terminal:', err);
      });
  }, [addTerminal]);

  const rootPath = useFileExplorerStore((s) => s.rootPath);
  const hasAutoCreated = useRef(false);

  // Auto-create a terminal once rootPath is available (ensures correct cwd)
  useEffect(() => {
    if (hasAutoCreated.current) return;
    if (!rootPath) return;
    if (useTerminalStore.getState().terminals.size > 0) return;
    hasAutoCreated.current = true;
    handleNewTerminal();
  }, [rootPath, handleNewTerminal]);

  const handleCloseTab = useCallback(
    (id: string) => {
      killTerminal(id).catch(() => {});
      removeTerminal(id);
      // If that was the last terminal, close the section
      const remaining = useTerminalStore.getState().terminals.size;
      if (remaining === 0) {
        toggleTerminalPanel();
      }
    },
    [removeTerminal, toggleTerminalPanel],
  );

  const handleTerminalExit = useCallback(
    (id: string) => (_code: number | null) => {
      markExited(id);
    },
    [markExited],
  );

  const terminalList = [...terminals.values()];

  return (
    <div className="flex flex-col h-full bg-background terminal-panel">
      {/* Header / tab bar */}
      <div
        className="flex items-center justify-between px-1.5 shrink-0 border-b border-border/30 bg-sidebar"
        style={{ height: TERMINAL_SECTION.headerHeight }}
      >
        {/* Tabs */}
        <div className="relative min-w-0 flex-1">
          {(scrollState === 'left' || scrollState === 'both') && (
            <div className="absolute left-0 top-0 bottom-0 w-4 bg-gradient-to-r from-sidebar to-transparent z-10 pointer-events-none" />
          )}
          {(scrollState === 'right' || scrollState === 'both') && (
            <div className="absolute right-0 top-0 bottom-0 w-4 bg-gradient-to-l from-sidebar to-transparent z-10 pointer-events-none" />
          )}
          <div
            ref={tabsContainerRef}
            className="flex items-center gap-0.5 overflow-x-auto scrollbar-none"
            onScroll={updateScrollState}
          >
          {terminalList.map((t) => (
            <div
              key={t.id}
              role="tab"
              tabIndex={0}
              aria-selected={t.id === activeTerminalId}
              onClick={() => setActiveTerminal(t.id)}
              onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); handleCloseTab(t.id); } }}
              onDoubleClick={() => rename.startRename(t.id, t.title)}
              className={cn(
                'group relative flex items-center gap-1 px-3 py-2 text-[11px] max-w-40 shrink-0 cursor-pointer',
                'transition-colors duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]',
                !t.isAlive && 'opacity-60',
                t.id === activeTerminalId
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <TerminalWindow className={cn('w-3 h-3 shrink-0', !t.isAlive && 'opacity-50')} />
              {rename.renamingId === t.id ? (
                <input
                  {...rename.getInputProps()}
                  type="text"
                  className="w-full min-w-[60px] bg-muted/50 outline-none ring-1 ring-primary/40 rounded-[4px] text-[11px] text-foreground px-1.5 py-0.5 -my-0.5 selection:bg-primary/20"
                />
              ) : (
                <span className="truncate">{t.title}</span>
              )}
              <button
                aria-label={`Close ${t.title}`}
                onClick={(e) => { e.stopPropagation(); handleCloseTab(t.id); }}
                className="ml-auto shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted-foreground/20 transition-opacity duration-100 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-primary/50"
              >
                <X className="w-3 h-3" />
              </button>
              {/* Accent bar under active tab */}
              {t.id === activeTerminalId && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-primary" />
              )}
            </div>
          ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={handleNewTerminal}
            className="p-1 rounded-lg cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted/60 hover:scale-105 active:scale-95 transition-[transform,background-color,color] duration-150"
            title="New Terminal (⌃⇧`)"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal body — all terminals rendered, inactive hidden via CSS to preserve state */}
      <div className="flex-1 min-h-0 relative">
        {terminalList.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            No terminal
          </div>
        ) : (
          terminalList.map((t) => (
            <div
              key={t.id}
              className="absolute inset-0"
              style={{ display: t.id === activeTerminalId ? 'block' : 'none' }}
            >
              <TerminalView
                terminalId={t.id}
                isActive={t.id === activeTerminalId}
                onExit={handleTerminalExit(t.id)}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
};
