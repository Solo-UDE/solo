/**
 * FileExplorer - Main file explorer container component
 */

import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { FolderOpen, X } from '@phosphor-icons/react';
import { FileTree } from './FileTree';
import { useFileExplorerStore } from '../../stores/fileExplorerStore';
import type { BackendEvent } from '../../bindings';

interface FileExplorerProps {
  onFileOpen?: (path: string) => void;
  className?: string;
}

export function FileExplorer({ onFileOpen, className = '' }: FileExplorerProps) {
  const rootPath = useFileExplorerStore((s) => s.rootPath);
  const error = useFileExplorerStore((s) => s.error);
  const setError = useFileExplorerStore((s) => s.setError);

  const handleFileCreated = useFileExplorerStore((s) => s.handleFileCreated);
  const handleFileDeleted = useFileExplorerStore((s) => s.handleFileDeleted);
  const handleFileChanged = useFileExplorerStore((s) => s.handleFileChanged);
  const handleFileRenamed = useFileExplorerStore((s) => s.handleFileRenamed);

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

  return (
    <div className={`flex flex-col h-full ${className}`}>
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
              Open a folder from the title bar
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
