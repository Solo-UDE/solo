/**
 * SidebarTerminal — Terminal section rendered at the bottom of the sidebar.
 * Manages its own tab bar and terminal lifecycle, rendering TerminalView directly
 * (bypasses the mosaic panel system).
 */

import { useCallback, useEffect, useRef } from 'react';
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
  const renameTerminal = useTerminalStore((s) => s.renameTerminal);
  const toggleTerminalPanel = useUIStore((s) => s.toggleTerminalPanel);

  const rename = useInlineRename((id, value) => renameTerminal(id, value));

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
      removeTerminal(id);
    },
    [removeTerminal],
  );

  const terminalList = [...terminals.values()];

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header / tab bar */}
      <div
        className="flex items-center justify-between px-1.5 shrink-0 border-b border-border/30 bg-sidebar"
        style={{ height: TERMINAL_SECTION.headerHeight }}
      >
        {/* Tabs */}
        <div className="relative flex items-center gap-0.5 overflow-x-auto min-w-0">
          {terminalList.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTerminal(t.id)}
              onDoubleClick={() => rename.startRename(t.id, t.title)}
              className={cn(
                'group relative flex items-center gap-1 px-3 py-2 text-[11px] max-w-32 cursor-pointer',
                'transition-colors duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]',
                t.id === activeTerminalId
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <TerminalWindow className="w-3 h-3 shrink-0" />
              {rename.renamingId === t.id ? (
                <input
                  {...rename.getInputProps()}
                  type="text"
                  className="w-full bg-transparent outline-none border-b border-primary text-[11px] text-foreground px-0"
                />
              ) : (
                <span className="truncate">{t.title}</span>
              )}
              <span
                role="button"
                onClick={(e) => { e.stopPropagation(); handleCloseTab(t.id); }}
                className="ml-auto shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted-foreground/20 transition-opacity duration-100"
              >
                <X className="w-3 h-3" />
              </span>
              {/* Accent bar under active tab */}
              {t.id === activeTerminalId && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-primary" />
              )}
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={handleNewTerminal}
            className="p-1 rounded-lg cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted/60 hover:scale-105 active:scale-95 transition-all duration-150"
            title="New Terminal"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal body */}
      <div className="flex-1 min-h-0">
        {activeTerminalId && terminals.has(activeTerminalId) ? (
          <TerminalView
            terminalId={activeTerminalId}
            isActive={true}
            onExit={handleTerminalExit(activeTerminalId)}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            No terminal
          </div>
        )}
      </div>
    </div>
  );
};
