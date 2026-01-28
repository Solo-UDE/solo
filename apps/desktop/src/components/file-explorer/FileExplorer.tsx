/**
 * FileExplorer - Main file explorer container component
 */

import { useCallback, useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  FolderOpen,
  RefreshCw,
  FilePlus,
  FolderPlus,
  X,
} from 'lucide-react';
import { FileTree } from './FileTree';
import { InputDialog } from './InputDialog';
import { useFileExplorerStore, getParentPath } from '../../stores/fileExplorerStore';
import type { BackendEvent } from '../../bindings';

interface InputDialogState {
  isOpen: boolean;
  type: 'file' | 'folder';
  targetDir: string;
}

interface FileExplorerProps {
  onFileOpen?: (path: string) => void;
  className?: string;
}

export function FileExplorer({ onFileOpen, className = '' }: FileExplorerProps) {
  const rootPath = useFileExplorerStore((s) => s.rootPath);
  const error = useFileExplorerStore((s) => s.error);
  const selected = useFileExplorerStore((s) => s.selected);

  const openFolder = useFileExplorerStore((s) => s.openFolder);
  const closeFolder = useFileExplorerStore((s) => s.closeFolder);
  const setRootPath = useFileExplorerStore((s) => s.setRootPath);
  const setError = useFileExplorerStore((s) => s.setError);
  const createFile = useFileExplorerStore((s) => s.createFile);
  const createDirectory = useFileExplorerStore((s) => s.createDirectory);

  const handleFileCreated = useFileExplorerStore((s) => s.handleFileCreated);
  const handleFileDeleted = useFileExplorerStore((s) => s.handleFileDeleted);
  const handleFileChanged = useFileExplorerStore((s) => s.handleFileChanged);
  const handleFileRenamed = useFileExplorerStore((s) => s.handleFileRenamed);

  // Input dialog state for New File/Folder
  const [inputDialog, setInputDialog] = useState<InputDialogState>({
    isOpen: false,
    type: 'file',
    targetDir: '',
  });

  // Subscribe to backend file events
  useEffect(() => {
    const unlisten = listen<BackendEvent>('backend-event', (event) => {
      const payload = event.payload;

      switch (payload.type) {
        case 'file:created':
          handleFileCreated(payload.payload.path);
          break;
        case 'file:deleted':
          handleFileDeleted(payload.payload.path);
          break;
        case 'file:changed':
          handleFileChanged(payload.payload.path);
          break;
        case 'file:renamed':
          handleFileRenamed(
            payload.payload.old_path,
            payload.payload.new_path
          );
          break;
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleFileCreated, handleFileDeleted, handleFileChanged, handleFileRenamed]);

  const handleRefresh = useCallback(() => {
    if (rootPath) {
      setRootPath(rootPath);
    }
  }, [rootPath, setRootPath]);

  // Get the target directory for new file/folder operations
  const getTargetDirectory = useCallback((): string | null => {
    const selectedPaths = Array.from(selected);

    if (selectedPaths.length > 0) {
      const entries = useFileExplorerStore.getState().entries;
      const entry = entries.get(selectedPaths[0]);
      return entry?.is_dir ? selectedPaths[0] : getParentPath(selectedPaths[0]);
    }

    return rootPath;
  }, [selected, rootPath]);

  const handleNewFile = useCallback(() => {
    const targetDir = getTargetDirectory();
    if (!targetDir) return;

    setInputDialog({
      isOpen: true,
      type: 'file',
      targetDir,
    });
  }, [getTargetDirectory]);

  const handleNewFolder = useCallback(() => {
    const targetDir = getTargetDirectory();
    if (!targetDir) return;

    setInputDialog({
      isOpen: true,
      type: 'folder',
      targetDir,
    });
  }, [getTargetDirectory]);

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

  const folderName = rootPath?.split('/').pop() ?? '';

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header - only shown when a folder is open */}
      {rootPath && (
        <div
          className="flex items-center justify-between px-3 py-2 border-b border-border"
          data-tauri-drag-region="false"
        >
          <div className="flex items-center gap-2 min-w-0">
            <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
            <span className="text-sm font-medium truncate">{folderName}</span>
          </div>

          <div className="flex items-center gap-1" style={{ pointerEvents: 'auto' }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleNewFile();
              }}
              className="p-1.5 rounded hover:bg-muted transition-colors cursor-pointer"
              title="New File"
            >
              <FilePlus className="w-4 h-4 text-muted-foreground" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleNewFolder();
              }}
              className="p-1.5 rounded hover:bg-muted transition-colors cursor-pointer"
              title="New Folder"
            >
              <FolderPlus className="w-4 h-4 text-muted-foreground" />
            </button>
            <button
              onClick={handleRefresh}
              className="p-1.5 rounded hover:bg-muted transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4 text-muted-foreground" />
            </button>
            <button
              onClick={closeFolder}
              className="p-1.5 rounded hover:bg-muted transition-colors"
              title="Close Folder"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="px-3 py-2 bg-destructive/20 text-destructive text-sm flex items-center justify-between">
          <span className="truncate">{error}</span>
          <button
            onClick={() => setError(null)}
            className="p-1 hover:bg-destructive/20 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {rootPath ? (
          <FileTree onFileOpen={onFileOpen} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-4 p-4">
            <FolderOpen className="w-12 h-12 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground text-center">
              Open a folder to view files
            </p>
            <button
              onClick={openFolder}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Open Folder
            </button>
          </div>
        )}
      </div>

      {/* Input Dialog for New File/Folder */}
      <InputDialog
        isOpen={inputDialog.isOpen}
        title={inputDialog.type === 'file' ? 'New File' : 'New Folder'}
        placeholder={inputDialog.type === 'file' ? 'filename.txt' : 'folder-name'}
        onSubmit={handleInputDialogSubmit}
        onCancel={handleInputDialogCancel}
      />
    </div>
  );
}
