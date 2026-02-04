/**
 * FileTree - Virtualized file tree with keyboard navigation
 */

import React, { useCallback, useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { FileTreeNode } from './FileTreeNode';
import { CreationRow } from './CreationRow';
import {
  useFileExplorerStore,
  useFlattenedTree,
  getParentPath,
} from '../../stores/fileExplorerStore';
import { revealInFinder } from '../../lib/tauri/fs';

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
  const startCreating = useFileExplorerStore((s) => s.startCreating);
  const cancelCreating = useFileExplorerStore((s) => s.cancelCreating);
  const submitCreating = useFileExplorerStore((s) => s.submitCreating);
  const creatingInPath = useFileExplorerStore((s) => s.creatingInPath);

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

      // Skip keyboard nav when inline creation input is active
      if (creatingInPath) return;

      const selectedPaths = Array.from(selected);
      const firstSelectedIndex = flattenedTree.findIndex(
        (item) => item.kind === 'entry' && selectedPaths[0] === item.entry.path
      );

      // Helper to find the next navigable entry item, skipping ghost rows
      const findNextEntry = (from: number, direction: 1 | -1): number => {
        let idx = from + direction;
        while (idx >= 0 && idx < flattenedTree.length) {
          if (flattenedTree[idx].kind === 'entry') return idx;
          idx += direction;
        }
        return from;
      };

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const nextIndex = findNextEntry(firstSelectedIndex, 1);
          const item = flattenedTree[nextIndex];
          if (item?.kind === 'entry') {
            selectFile(item.entry.path);
            virtualizer.scrollToIndex(nextIndex);
          }
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prevIndex = findNextEntry(firstSelectedIndex, -1);
          const item = flattenedTree[prevIndex];
          if (item?.kind === 'entry') {
            selectFile(item.entry.path);
            virtualizer.scrollToIndex(prevIndex);
          }
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          const item = flattenedTree[firstSelectedIndex];
          if (item?.kind === 'entry' && item.entry.is_dir && !expanded.has(item.entry.path)) {
            toggleDirectory(item.entry.path);
          }
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          const item = flattenedTree[firstSelectedIndex];
          if (item?.kind === 'entry' && item.entry.is_dir && expanded.has(item.entry.path)) {
            toggleDirectory(item.entry.path);
          }
          break;
        }
        case 'Enter': {
          e.preventDefault();
          const item = flattenedTree[firstSelectedIndex];
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
    creatingInPath,
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

  const handleRenameSubmit = useCallback(
    (path: string, newName: string) => {
      rename(path, newName);
    },
    [rename]
  );

  // Scroll the ghost creation row into view when it appears
  useEffect(() => {
    if (creatingInPath) {
      const idx = flattenedTree.findIndex((item) => item.kind === 'creating');
      if (idx >= 0) {
        virtualizer.scrollToIndex(idx, { align: 'auto' });
      }
    }
  }, [creatingInPath, flattenedTree, virtualizer]);

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
              onDelete={() => deleteFiles([entryPath])}
              onCopyPath={() => writeText(entryPath).catch(console.error)}
              onRevealInFinder={() => revealInFinder(entryPath).catch(console.error)}
            />
          );
        })}
      </div>
    </div>
  );
}
