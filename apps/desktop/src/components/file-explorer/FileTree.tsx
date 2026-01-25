/**
 * FileTree - Virtualized file tree with keyboard navigation
 */

import React, { useCallback, useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FileTreeNode } from './FileTreeNode';
import {
  useFileExplorerStore,
  useFlattenedTree,
} from '../../stores/fileExplorerStore';

const ROW_HEIGHT = 28;
const OVERSCAN = 10;

interface FileTreeProps {
  onFileOpen?: (path: string) => void;
}

export function FileTree({ onFileOpen }: FileTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const flattenedTree = useFlattenedTree();

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

  const virtualizer = useVirtualizer({
    count: flattenedTree.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if container is focused or has focus within
      if (!containerRef.current?.contains(document.activeElement)) return;

      const selectedPaths = Array.from(selected);
      const firstSelectedIndex = flattenedTree.findIndex(
        (item) => selectedPaths[0] === item.entry.path
      );

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const nextIndex = Math.min(
            firstSelectedIndex + 1,
            flattenedTree.length - 1
          );
          if (nextIndex >= 0 && flattenedTree[nextIndex]) {
            selectFile(flattenedTree[nextIndex].entry.path);
            virtualizer.scrollToIndex(nextIndex);
          }
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prevIndex = Math.max(firstSelectedIndex - 1, 0);
          if (flattenedTree[prevIndex]) {
            selectFile(flattenedTree[prevIndex].entry.path);
            virtualizer.scrollToIndex(prevIndex);
          }
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          const entry = flattenedTree[firstSelectedIndex]?.entry;
          if (entry?.is_dir && !expanded.has(entry.path)) {
            toggleDirectory(entry.path);
          }
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          const entry = flattenedTree[firstSelectedIndex]?.entry;
          if (entry?.is_dir && expanded.has(entry.path)) {
            toggleDirectory(entry.path);
          }
          break;
        }
        case 'Enter': {
          e.preventDefault();
          const entry = flattenedTree[firstSelectedIndex]?.entry;
          if (entry) {
            if (entry.is_dir) {
              toggleDirectory(entry.path);
            } else if (onFileOpen) {
              onFileOpen(entry.path);
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
        case 'Delete':
        case 'Backspace': {
          if (!renamingPath && selectedPaths.length > 0) {
            e.preventDefault();
            deleteFiles(selectedPaths);
          }
          break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    flattenedTree,
    selected,
    expanded,
    renamingPath,
    selectFile,
    toggleDirectory,
    startRename,
    deleteFiles,
    onFileOpen,
    virtualizer,
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

  const handleContextMenu = useCallback(
    (path: string, event: React.MouseEvent) => {
      event.preventDefault();
      // Select the item if not already selected
      if (!selected.has(path)) {
        selectFile(path);
      }
      // Context menu will be handled by parent
    },
    [selected, selectFile]
  );

  const handleRenameSubmit = useCallback(
    (path: string, newName: string) => {
      rename(path, newName);
    },
    [rename]
  );

  if (flattenedTree.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No files to display
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full overflow-auto outline-none"
      tabIndex={0}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = flattenedTree[virtualRow.index];
          if (!item) return null;

          return (
            <FileTreeNode
              key={item.entry.path}
              entry={item.entry}
              depth={item.depth}
              isExpanded={expanded.has(item.entry.path)}
              isSelected={selected.has(item.entry.path)}
              isLoading={loading.has(item.entry.path)}
              isRenaming={renamingPath === item.entry.path}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: ROW_HEIGHT,
                transform: `translateY(${virtualRow.start}px)`,
              }}
              onToggle={() => toggleDirectory(item.entry.path)}
              onClick={(e) => handleClick(item.entry.path, e)}
              onDoubleClick={() => handleDoubleClick(item.entry)}
              onContextMenu={(e) => handleContextMenu(item.entry.path, e)}
              onRenameSubmit={(newName) =>
                handleRenameSubmit(item.entry.path, newName)
              }
              onRenameCancel={cancelRename}
            />
          );
        })}
      </div>
    </div>
  );
}
