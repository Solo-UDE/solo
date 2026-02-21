/**
 * FileExplorer - Main file explorer container component
 */

import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { FolderOpen, X } from '@phosphor-icons/react';
import { motion } from 'motion/react';
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
          <motion.div
            className="flex flex-col items-center justify-center h-full gap-3 p-4"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          >
            <div className="w-12 h-12 rounded-2xl bg-muted/50 flex items-center justify-center">
              <FolderOpen className="w-6 h-6 text-muted-foreground/40" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-muted-foreground">No folder open</p>
              <p className="text-xs text-muted-foreground/60">Open a folder from the title bar</p>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
