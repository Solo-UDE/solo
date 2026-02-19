import { useState, useCallback, useRef, useEffect } from 'react';
import { X, FolderOpen, GitBranch, SpinnerGap, Warning } from '@phosphor-icons/react';
import { openFolderDialog } from '@/lib/tauri/fs';
import { gitClone } from '@/lib/tauri/git';
import { useWorkspaceStore } from '@/stores/workspaceStore';

/** Extract the repo name from a GitHub URL for use as subfolder name */
const repoNameFromUrl = (url: string): string => {
  const cleaned = url.replace(/\.git$/, '').replace(/\/$/, '');
  const parts = cleaned.split('/');
  return parts[parts.length - 1] || '';
};

interface CloneDialogProps {
  onClose: () => void;
}

export function CloneDialog({ onClose }: CloneDialogProps) {
  const [repoUrl, setRepoUrl] = useState('');
  const [destFolder, setDestFolder] = useState('');
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const switchWorkspace = useWorkspaceStore((s) => s.switchWorkspace);

  // Focus URL input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !cloning) onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, cloning]);

  const handleBrowse = useCallback(async () => {
    const path = await openFolderDialog();
    if (path) setDestFolder(path);
  }, []);

  const handleClone = useCallback(async () => {
    if (!repoUrl.trim() || !destFolder.trim()) return;

    setError(null);
    setCloning(true);

    try {
      // Build the full target path: destFolder / repoName
      const repoName = repoNameFromUrl(repoUrl.trim());
      const targetPath = repoName
        ? `${destFolder.replace(/\/$/, '')}/${repoName}`
        : destFolder;

      const clonedPath = await gitClone(repoUrl.trim(), targetPath);
      await switchWorkspace(clonedPath);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCloning(false);
    }
  }, [repoUrl, destFolder, switchWorkspace, onClose]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      handleClone();
    },
    [handleClone],
  );

  const canClone = repoUrl.trim().length > 0 && destFolder.trim().length > 0 && !cloning;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-in fade-in duration-150"
        onClick={cloning ? undefined : onClose}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-md bg-card/95 backdrop-blur-md rounded-[14px] shadow-[0_8px_32px_-8px_rgba(0,0,0,0.3)] border border-border/30 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Clone Repository</h2>
          </div>
          <button
            onClick={onClose}
            disabled={cloning}
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-muted/60 transition-colors duration-150 disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-5 pb-5 space-y-4">
          {/* Repository URL */}
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Repository URL</label>
            <input
              ref={inputRef}
              type="text"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/user/repo"
              disabled={cloning}
              className="w-full h-9 px-3 rounded-lg bg-muted/40 border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:bg-muted/60 focus:ring-1 focus:ring-ring/30 focus:outline-none transition-colors duration-150 disabled:opacity-50"
            />
          </div>

          {/* Destination Folder */}
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Destination Folder</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={destFolder}
                onChange={(e) => setDestFolder(e.target.value)}
                placeholder="/Users/you/projects"
                disabled={cloning}
                className="flex-1 h-9 px-3 rounded-lg bg-muted/40 border-none text-sm text-foreground placeholder:text-muted-foreground/50 focus:bg-muted/60 focus:ring-1 focus:ring-ring/30 focus:outline-none transition-colors duration-150 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={handleBrowse}
                disabled={cloning}
                className="h-9 px-3 rounded-lg bg-muted/40 text-xs text-foreground/80 hover:bg-muted/60 active:scale-[0.97] transition-all duration-150 flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Browse
              </button>
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-xs">
              <Warning className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Clone button */}
          <button
            type="submit"
            disabled={!canClone}
            className="w-full h-9 rounded-[10px] bg-primary text-primary-foreground text-xs font-medium shadow-sm hover:brightness-110 active:scale-[0.97] transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
          >
            {cloning ? (
              <>
                <SpinnerGap className="w-3.5 h-3.5 animate-spin" />
                Cloning...
              </>
            ) : (
              'Clone'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
