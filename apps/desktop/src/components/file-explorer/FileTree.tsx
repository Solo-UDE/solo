/**
 * FileTree - Virtualized file tree with keyboard navigation
 */

import React, { useCallback, useRef, useEffect, useState, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { FileTreeNode } from './FileTreeNode';
import { CreationRow } from './CreationRow';
import { ConfirmDialog } from './ConfirmDialog';
import {
  useFileExplorerStore,
  useFlattenedTree,
  getParentPath,
  getFileName,
} from '../../stores/fileExplorerStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { revealInFinder } from '../../lib/tauri/fs';
import { createTerminal } from '../../lib/tauri/terminal';
import { useTerminalStore } from '../../stores/terminalStore';
import { useUIStore } from '../../stores/uiStore';

const ROW_HEIGHT = 28;
const OVERSCAN = 10;

interface FileTreeProps {
  onFileOpen?: (path: string) => void;
}

export function FileTree({ onFileOpen }: FileTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const flattenedTree = useFlattenedTree();

  // B1: Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<{ paths: string[]; name: string; isDir: boolean } | null>(null);

  // B2: Hidden files setting
  const showHiddenFiles = useSettingsStore((s) => s.files.showHiddenFiles);

  const selected = useFileExplorerStore((s) => s.selected);
  const expanded = useFileExplorerStore((s) => s.expanded);
  const loading = useFileExplorerStore((s) => s.loading);
  const renamingPath = useFileExplorerStore((s) => s.renamingPath);

  const selectFile = useFileExplorerStore((s) => s.selectFile);
  const toggleDirectory = useFileExplorerStore((s) => s.toggleDirectory);
  const rename = useFileExplorerStore((s) => s.rename);
  const cancelRename = useFileExplorerStore((s) => s.cancelRename);
  const startRename = useFileExplorerStore((s) => s.startRename);
  const deleteFiles = useFileExplorerStore((s) => s.delete);
  const startCreating = useFileExplorerStore((s) => s.startCreating);
  const cancelCreating = useFileExplorerStore((s) => s.cancelCreating);
  const submitCreating = useFileExplorerStore((s) => s.submitCreating);
  const creatingInPath = useFileExplorerStore((s) => s.creatingInPath);

  // B2: Filter hidden files from the flattened tree (must be before virtualizer)
  const visibleTree = useMemo(() => {
    if (showHiddenFiles) return flattenedTree;
    return flattenedTree.filter((item) => {
      if (item.kind === 'creating') return true;
      return !item.entry.name.startsWith('.');
    });
  }, [flattenedTree, showHiddenFiles]);

  // Virtualizer using filtered tree
  const filteredVirtualizer = useVirtualizer({
    count: visibleTree.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  // B1: Show delete confirmation dialog
  const requestDeleteConfirm = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      const entries = useFileExplorerStore.getState().entries;
      const firstName = getFileName(paths[0]);
      const firstEntry = entries.get(paths[0]);
      const isDir = firstEntry?.is_dir ?? false;

      if (paths.length === 1) {
        setDeleteConfirm({
          paths,
          name: firstName,
          isDir,
        });
      } else {
        setDeleteConfirm({
          paths,
          name: `${paths.length} items`,
          isDir: false,
        });
      }
    },
    []
  );

  const handleConfirmDelete = useCallback(() => {
    if (deleteConfirm) {
      deleteFiles(deleteConfirm.paths);
      setDeleteConfirm(null);
    }
  }, [deleteConfirm, deleteFiles]);

  const handleCancelDelete = useCallback(() => {
    setDeleteConfirm(null);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if container is focused or has focus within
      if (!containerRef.current?.contains(document.activeElement)) return;

      // Skip keyboard nav when inline creation input is active
      if (creatingInPath) return;

      const selectedPaths = Array.from(selected);
      const firstSelectedIndex = visibleTree.findIndex(
        (item) => item.kind === 'entry' && selectedPaths[0] === item.entry.path
      );

      // Helper to find the next navigable entry item, skipping ghost rows
      const findNextEntry = (from: number, direction: 1 | -1): number => {
        let idx = from + direction;
        while (idx >= 0 && idx < visibleTree.length) {
          if (visibleTree[idx].kind === 'entry') return idx;
          idx += direction;
        }
        return from;
      };

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const nextIndex = findNextEntry(firstSelectedIndex, 1);
          const item = visibleTree[nextIndex];
          if (item?.kind === 'entry') {
            selectFile(item.entry.path);
            filteredVirtualizer.scrollToIndex(nextIndex);
          }
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prevIndex = findNextEntry(firstSelectedIndex, -1);
          const item = visibleTree[prevIndex];
          if (item?.kind === 'entry') {
            selectFile(item.entry.path);
            filteredVirtualizer.scrollToIndex(prevIndex);
          }
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          const item = visibleTree[firstSelectedIndex];
          if (item?.kind === 'entry' && item.entry.is_dir && !expanded.has(item.entry.path)) {
            toggleDirectory(item.entry.path);
          }
          break;
        }
        case 'Enter': {
          e.preventDefault();
          const item = visibleTree[firstSelectedIndex];
          if (item?.kind === 'entry') {
            if (item.entry.is_dir) {
              toggleDirectory(item.entry.path);
            } else if (onFileOpen) {
              onFileOpen(item.entry.path);
            }
          }
          break;
        }
        case 'F2': {
          e.preventDefault();
          if (selectedPaths.length === 1) {
            startRename(selectedPaths[0]);
          }
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          const leftItem = visibleTree[firstSelectedIndex];
          if (leftItem?.kind === 'entry') {
            if (leftItem.entry.is_dir && expanded.has(leftItem.entry.path)) {
              // Collapse expanded directory
              toggleDirectory(leftItem.entry.path);
            } else {
              // B8: Navigate to parent directory
              const parentPath = getParentPath(leftItem.entry.path);
              const parentIndex = visibleTree.findIndex(
                (item) => item.kind === 'entry' && item.entry.path === parentPath
              );
              if (parentIndex >= 0) {
                const parentItem = visibleTree[parentIndex];
                if (parentItem?.kind === 'entry') {
                  selectFile(parentItem.entry.path);
                  filteredVirtualizer.scrollToIndex(parentIndex);
                }
              }
            }
          }
          break;
        }
        case 'Delete':
        case 'Backspace': {
          if (!renamingPath && selectedPaths.length > 0) {
            e.preventDefault();
            // B1: Show confirmation instead of deleting immediately
            requestDeleteConfirm(selectedPaths);
          }
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    visibleTree,
    selected,
    expanded,
    renamingPath,
    creatingInPath,
    selectFile,
    toggleDirectory,
    startRename,
    deleteFiles,
    requestDeleteConfirm,
    onFileOpen,
    filteredVirtualizer,
  ]);

  const handleClick = useCallback(
    (path: string, event: React.MouseEvent) => {
      selectFile(path, event.metaKey || event.ctrlKey);
    },
    [selectFile]
  );

  const handleDoubleClick = useCallback(
    (entry: { path: string; is_dir: boolean }) => {
      if (entry.is_dir) {
        toggleDirectory(entry.path);
      } else if (onFileOpen) {
        onFileOpen(entry.path);
      }
    },
    [toggleDirectory, onFileOpen]
  );

  const handleRenameSubmit = useCallback(
    (path: string, newName: string) => {
      rename(path, newName);
    },
    [rename]
  );

  // B7: Open directory in terminal
  const handleOpenInTerminal = useCallback((dirPath: string) => {
    createTerminal(dirPath)
      .then(({ id, shell }) => {
        useTerminalStore.getState().addTerminal(id, dirPath, shell);
        if (!useUIStore.getState().terminalPanelOpen) {
          useUIStore.getState().toggleTerminalPanel();
        }
      })
      .catch((err) => console.error('Failed to open terminal:', err));
  }, []);

  // Scroll the ghost creation row into view when it appears
  useEffect(() => {
    if (creatingInPath) {
      const idx = visibleTree.findIndex((item) => item.kind === 'creating');
      if (idx >= 0) {
        filteredVirtualizer.scrollToIndex(idx, { align: 'auto' });
      }
    }
  }, [creatingInPath, visibleTree, filteredVirtualizer]);

  if (visibleTree.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No files to display
      </div>
    );
  }

  return (
    <>
    <div
      ref={containerRef}
      className="h-full overflow-auto outline-none"
      tabIndex={0}
    >
      <div
        style={{
          height: filteredVirtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {filteredVirtualizer.getVirtualItems().map((virtualRow) => {
          const item = visibleTree[virtualRow.index];
          if (!item) return null;

          const rowStyle: React.CSSProperties = {
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: ROW_HEIGHT,
            transform: `translateY(${virtualRow.start}px)`,
          };

          if (item.kind === 'creating') {
            return (
              <CreationRow
                key={`creating-${item.parentPath}`}
                type={item.type}
                depth={item.depth}
                style={rowStyle}
                onSubmit={submitCreating}
                onCancel={cancelCreating}
              />
            );
          }

          const entryPath = item.entry.path;
          const targetDir = item.entry.is_dir ? entryPath : getParentPath(entryPath);

          return (
            <FileTreeNode
              key={item.entry.path}
              entry={item.entry}
              depth={item.depth}
              isExpanded={expanded.has(item.entry.path)}
              isSelected={selected.has(item.entry.path)}
              isLoading={loading.has(item.entry.path)}
              isRenaming={renamingPath === item.entry.path}
              style={rowStyle}
              onToggle={() => toggleDirectory(item.entry.path)}
              onClick={(e) => handleClick(item.entry.path, e)}
              onDoubleClick={() => handleDoubleClick(item.entry)}
              onRenameSubmit={(newName) =>
                handleRenameSubmit(item.entry.path, newName)
              }
              onRenameCancel={cancelRename}
              onNewFile={() => startCreating(targetDir, 'file')}
              onNewFolder={() => startCreating(targetDir, 'folder')}
              onStartRename={() => startRename(entryPath)}
              onDelete={() => requestDeleteConfirm([entryPath])}
              onCopyPath={() => writeText(entryPath).catch(console.error)}
              onRevealInFinder={() => revealInFinder(entryPath).catch(console.error)}
              onOpenInTerminal={item.entry.is_dir ? () => handleOpenInTerminal(entryPath) : undefined}
            />
          );
        })}
      </div>
    </div>

    {/* B1: Delete confirmation dialog */}
    {deleteConfirm && (
      <ConfirmDialog
        isOpen={true}
        title={deleteConfirm.isDir ? 'Delete Folder' : 'Delete File'}
        message={
          deleteConfirm.isDir
            ? `"${deleteConfirm.name}" and all its contents will be permanently deleted.`
            : `"${deleteConfirm.name}" will be permanently deleted.`
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
        variant="destructive"
      />
    )}
    </>
  );
}
