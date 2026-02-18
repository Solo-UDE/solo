/**
 * EditorTabs - Tab bar for managing open files
 * Shows dirty indicators, close buttons, and handles tab switching
 */

import { useCallback, useState } from 'react';
import { X, FileText } from '@phosphor-icons/react';
import { useEditorStore, getFileName } from '../../stores/editorStore';
import { ConfirmDialog } from '../ui/confirm-dialog';

interface EditorTabsProps {
  className?: string;
}

export function EditorTabs({ className = '' }: EditorTabsProps) {
  const tabOrder = useEditorStore((s) => s.tabOrder);
  const tabs = useEditorStore((s) => s.tabs);
  const activeTab = useEditorStore((s) => s.activeTab);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const closeTab = useEditorStore((s) => s.closeTab);

  const [confirmClose, setConfirmClose] = useState<{
    path: string;
    name: string;
  } | null>(null);

  const handleTabClick = useCallback(
    (path: string) => {
      setActiveTab(path);
    },
    [setActiveTab]
  );

  const handleCloseClick = useCallback(
    (e: React.MouseEvent, path: string) => {
      e.stopPropagation();

      const tab = tabs.get(path);
      if (tab && tab.currentContent !== tab.originalContent) {
        // Show confirmation for dirty files
        setConfirmClose({ path, name: getFileName(path) });
      } else {
        closeTab(path);
      }
    },
    [tabs, closeTab]
  );

  const handleConfirmClose = useCallback(() => {
    if (!confirmClose) return;

    closeTab(confirmClose.path);
    setConfirmClose(null);
  }, [confirmClose, closeTab]);

  const handleCancelClose = useCallback(() => {
    setConfirmClose(null);
  }, []);

  // Handle middle-click to close
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, path: string) => {
      if (e.button === 1) {
        // Middle click
        e.preventDefault();
        const tab = tabs.get(path);
        if (tab && tab.currentContent !== tab.originalContent) {
          setConfirmClose({ path, name: getFileName(path) });
        } else {
          closeTab(path);
        }
      }
    },
    [tabs, closeTab]
  );

  if (tabOrder.length === 0) {
    return null;
  }

  return (
    <>
      <div
        className={`flex items-center h-8 bg-card/80 backdrop-blur-sm border-b border-border/30 overflow-x-auto ${className}`}
      >
        {tabOrder.map((path) => {
          const tab = tabs.get(path);
          if (!tab) return null;

          const isActive = path === activeTab;
          const isDirty = tab.currentContent !== tab.originalContent;
          const fileName = getFileName(path);

          return (
            <div
              key={path}
              onClick={() => handleTabClick(path)}
              onMouseDown={(e) => handleMouseDown(e, path)}
              className={`
                group flex items-center gap-2 px-3 py-1.5 cursor-pointer
                min-w-0 max-w-48 rounded-t-lg transition-[background-color,color] duration-200
                ${isActive
                  ? 'bg-background shadow-sm'
                  : 'hover:bg-muted/60 hover:scale-[1.01]'}
              `}
              title={path}
            >
              <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
              <span
                className={`text-[13px] truncate transition-colors ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}
              >
                {fileName}
              </span>

              {/* Dirty indicator or close button */}
              <div className="w-4 h-4 shrink-0 flex items-center justify-center">
                {isDirty ? (
                  <div
                    className="w-2 h-2 rounded-full bg-primary animate-pulse group-hover:hidden"
                    title="Unsaved changes"
                  />
                ) : null}

                <button
                  onClick={(e) => handleCloseClick(e, path)}
                  className={`
                    w-4 h-4 rounded-md flex items-center justify-center
                    hover:bg-muted/60 hover:scale-105 active:scale-95 transition-[transform,background-color] duration-150
                    ${isDirty ? 'hidden group-hover:flex' : 'opacity-0 group-hover:opacity-100'}
                  `}
                  title="Close"
                >
                  <X className="w-3 h-3 text-muted-foreground" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Unsaved changes confirmation dialog */}
      {confirmClose && (
        <ConfirmDialog
          isOpen={true}
          title="Unsaved Changes"
          message={`"${confirmClose.name}" has unsaved changes. Close anyway?`}
          confirmLabel="Close Without Saving"
          cancelLabel="Cancel"
          onConfirm={handleConfirmClose}
          onCancel={handleCancelClose}
          variant="destructive"
        />
      )}
    </>
  );
}
