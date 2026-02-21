import { useState, useCallback, useRef, useEffect } from 'react';
import { X, FolderOpen, GitBranch, GithubLogo, SpinnerGap, Warning } from '@phosphor-icons/react';
import { Button, IconButton, Input } from '@solo/ui';
import { openFolderDialog } from '@/lib/tauri/fs';
import { gitClone } from '@/lib/tauri/git';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useGitHubAccountsStore } from '@/stores/githubAccountsStore';

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
  const [needsAuth, setNeedsAuth] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const switchWorkspace = useWorkspaceStore((s) => s.switchWorkspace);
  const ghToken = useGitHubAccountsStore((s) => s.token);
  const connectGitHub = useGitHubAccountsStore((s) => s.connectGitHub);
  const isConnecting = useGitHubAccountsStore((s) => s.isConnecting);
  const loadToken = useGitHubAccountsStore((s) => s.loadToken);

  // Focus URL input on mount + load GitHub token
  useEffect(() => {
    inputRef.current?.focus();
    loadToken();
  }, [loadToken]);

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
    setNeedsAuth(false);
    setCloning(true);

    try {
      const repoName = repoNameFromUrl(repoUrl.trim());
      const targetPath = repoName
        ? `${destFolder.replace(/\/$/, '')}/${repoName}`
        : destFolder;

      // Pass GitHub token for HTTPS URLs (enables private repo cloning)
      const token = repoUrl.trim().startsWith('https://') ? ghToken ?? undefined : undefined;
      const clonedPath = await gitClone(repoUrl.trim(), targetPath, token);
      await switchWorkspace(clonedPath);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      // Detect authentication failure — offer to connect GitHub
      if (
        !ghToken &&
        (msg.includes('Authentication') || msg.includes('authentication') ||
         msg.includes('fatal: could not read') || msg.includes('403') || msg.includes('401'))
      ) {
        setNeedsAuth(true);
      }
      setCloning(false);
    }
  }, [repoUrl, destFolder, ghToken, switchWorkspace, onClose]);

  const handleConnectAndRetry = useCallback(async () => {
    try {
      await connectGitHub();
      // After connecting, retry the clone automatically
      handleClone();
    } catch {
      // connectGitHub sets its own error state
    }
  }, [connectGitHub, handleClone]);

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
          <IconButton
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={cloning}
            title="Close"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </IconButton>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-5 pb-5 space-y-4">
          {/* Repository URL */}
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Repository URL</label>
            <Input
              ref={inputRef}
              type="text"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/user/repo"
              disabled={cloning}
            />
          </div>

          {/* Destination Folder */}
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Destination Folder</label>
            <div className="flex gap-2">
              <Input
                type="text"
                value={destFolder}
                onChange={(e) => setDestFolder(e.target.value)}
                placeholder="/Users/you/projects"
                disabled={cloning}
                className="flex-1"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBrowse}
                disabled={cloning}
                className="h-9 px-3 text-xs"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Browse
              </Button>
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div className="space-y-2">
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-xs">
                <Warning className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
              {needsAuth && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleConnectAndRetry}
                  disabled={isConnecting}
                  className="w-full h-8 text-xs"
                >
                  <GithubLogo className="w-3.5 h-3.5" weight="bold" />
                  {isConnecting ? 'Connecting...' : 'Sign in with GitHub to clone private repos'}
                </Button>
              )}
            </div>
          )}

          {/* Clone button */}
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!canClone}
            className="w-full h-9 text-xs"
          >
            {cloning ? (
              <>
                <SpinnerGap className="w-3.5 h-3.5 animate-spin" />
                Cloning...
              </>
            ) : (
              'Clone'
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
