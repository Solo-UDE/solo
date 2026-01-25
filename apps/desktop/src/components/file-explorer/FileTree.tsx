/**
 * FileTree - Virtualized file tree with keyboard navigation
 */

import React, { useCallback, useRef, useEffect, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { FileTreeNode } from './FileTreeNode';
import { FileContextMenu } from './FileContextMenu';
import { InputDialog } from './InputDialog';
import { ConfirmDialog } from './ConfirmDialog';
import {
  useFileExplorerStore,
  useFlattenedTree,
  getParentPath,
  getFileName,
} from '../../stores/fileExplorerStore';
import { revealInFinder } from '../../lib/tauri/fs';

interface ContextMenuState {
  position: { x: number; y: number } | null;
  targetPath: string | null;
  isDirectory: boolean;
}

interface InputDialogState {
  isOpen: boolean;
  type: 'file' | 'folder';
  targetDir: string;
}

interface DeleteConfirmState {
  isOpen: boolean;
  paths: string[];
  message: string;
}

const ROW_HEIGHT = 28;
const OVERSCAN = 10;

interface FileTreeProps {
  onFileOpen?: (path: string) => void;
}

export function FileTree({ onFileOpen }: FileTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const flattenedTree = useFlattenedTree();

  const rootPath = useFileExplorerStore((s) => s.rootPath);
  const selected = useFileExplorerStore((s) => s.selected);
  const expanded = useFileExplorerStore((s) => s.expanded);
  const loading = useFileExplorerStore((s) => s.loading);
  const renamingPath = useFileExplorerStore((s) => s.renamingPath);
  const entries = useFileExplorerStore((s) => s.entries);

  const selectFile = useFileExplorerStore((s) => s.selectFile);
  const toggleDirectory = useFileExplorerStore((s) => s.toggleDirectory);
  const rename = useFileExplorerStore((s) => s.rename);
  const cancelRename = useFileExplorerStore((s) => s.cancelRename);
  const startRename = useFileExplorerStore((s) => s.startRename);
  const deleteFiles = useFileExplorerStore((s) => s.delete);
  const createFile = useFileExplorerStore((s) => s.createFile);
  const createDirectory = useFileExplorerStore((s) => s.createDirectory);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    position: null,
    targetPath: null,
    isDirectory: false,
  });

  // Input dialog state for New File/Folder from context menu
  const [inputDialog, setInputDialog] = useState<InputDialogState>({
    isOpen: false,
    type: 'file',
    targetDir: '',
  });

  // Delete confirmation dialog state
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState>({
    isOpen: false,
    paths: [],
    message: '',
  });

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
            // Show confirmation dialog
            const count = selectedPaths.length;
            const message =
              count === 1
                ? `Are you sure you want to delete "${getFileName(selectedPaths[0])}"?`
                : `Are you sure you want to delete ${count} items?`;
            setDeleteConfirm({
              isOpen: true,
              paths: selectedPaths,
              message,
            });
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
      // Show context menu
      const entry = entries.get(path);
      setContextMenu({
        position: { x: event.clientX, y: event.clientY },
        targetPath: path,
        isDirectory: entry?.is_dir ?? false,
      });
    },
    [selected, selectFile, entries]
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu({ position: null, targetPath: null, isDirectory: false });
  }, []);

  // Get target directory from context menu or root
  const getContextMenuTargetDir = useCallback((): string | null => {
    const targetPath = contextMenu.targetPath;
    if (!targetPath && !rootPath) return null;

    const entry = targetPath ? entries.get(targetPath) : null;
    return entry?.is_dir
      ? targetPath
      : targetPath
        ? getParentPath(targetPath)
        : rootPath;
  }, [contextMenu.targetPath, rootPath, entries]);

  const handleNewFile = useCallback(() => {
    const targetDir = getContextMenuTargetDir();
    if (!targetDir) return;

    setInputDialog({
      isOpen: true,
      type: 'file',
      targetDir,
    });
  }, [getContextMenuTargetDir]);

  const handleNewFolder = useCallback(() => {
    const targetDir = getContextMenuTargetDir();
    if (!targetDir) return;

    setInputDialog({
      isOpen: true,
      type: 'folder',
      targetDir,
    });
  }, [getContextMenuTargetDir]);

  const handleInputDialogSubmit = useCallback(
    (name: string) => {
      if (inputDialog.type === 'file') {
        createFile(inputDialog.targetDir, name);
      } else {
        createDirectory(inputDialog.targetDir, name);
      }
      setInputDialog((prev) => ({ ...prev, isOpen: false }));
    },
    [inputDialog.type, inputDialog.targetDir, createFile, createDirectory]
  );

  const handleInputDialogCancel = useCallback(() => {
    setInputDialog((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handleRenameFromMenu = useCallback(() => {
    if (contextMenu.targetPath) {
      startRename(contextMenu.targetPath);
    }
  }, [contextMenu.targetPath, startRename]);

  const handleDeleteFromMenu = useCallback(() => {
    if (contextMenu.targetPath) {
      setDeleteConfirm({
        isOpen: true,
        paths: [contextMenu.targetPath],
        message: `Are you sure you want to delete "${getFileName(contextMenu.targetPath)}"?`,
      });
    }
  }, [contextMenu.targetPath]);

  const handleDeleteConfirm = useCallback(() => {
    if (deleteConfirm.paths.length > 0) {
      deleteFiles(deleteConfirm.paths);
    }
    setDeleteConfirm({ isOpen: false, paths: [], message: '' });
  }, [deleteConfirm.paths, deleteFiles]);

  const handleDeleteCancel = useCallback(() => {
    setDeleteConfirm({ isOpen: false, paths: [], message: '' });
  }, []);

  const handleCopyPath = useCallback(async () => {
    if (contextMenu.targetPath) {
      try {
        await writeText(contextMenu.targetPath);
      } catch (e) {
        console.error('Failed to copy path:', e);
      }
    }
  }, [contextMenu.targetPath]);

  const handleRevealInFinder = useCallback(async () => {
    if (contextMenu.targetPath) {
      try {
        await revealInFinder(contextMenu.targetPath);
      } catch (e) {
        console.error('Failed to reveal in Finder:', e);
      }
    }
  }, [contextMenu.targetPath]);

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

      {/* Context Menu */}
      <FileContextMenu
        position={contextMenu.position}
        selectedPath={contextMenu.targetPath}
        isDirectory={contextMenu.isDirectory}
        onClose={closeContextMenu}
        onNewFile={handleNewFile}
        onNewFolder={handleNewFolder}
        onRename={handleRenameFromMenu}
        onDelete={handleDeleteFromMenu}
        onCopyPath={handleCopyPath}
        onRevealInFinder={handleRevealInFinder}
      />

      {/* Input Dialog for New File/Folder */}
      <InputDialog
        isOpen={inputDialog.isOpen}
        title={inputDialog.type === 'file' ? 'New File' : 'New Folder'}
        placeholder={inputDialog.type === 'file' ? 'filename.txt' : 'folder-name'}
        onSubmit={handleInputDialogSubmit}
        onCancel={handleInputDialogCancel}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        title="Delete"
        message={deleteConfirm.message}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
    </div>
  );
}
