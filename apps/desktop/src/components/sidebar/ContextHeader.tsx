/**
 * ContextHeader - Dynamic header showing branch/folder name + view-specific actions
 */

import { useCallback, useMemo } from 'react';
import type { FC } from 'react';
import { Cross2Icon, PlusIcon, ReloadIcon } from '@radix-ui/react-icons';
import { GitBranch, FolderOpen, FilePlus, FolderPlus, CloudDownload, CloudUpload, Minimize2, Network } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { useGitStore } from '@/stores/gitStore';
import { useActiveWorktree } from '@/stores/worktreeStore';
import { useFileExplorerStore, getParentPath } from '@/stores/fileExplorerStore';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface ContextHeaderProps {
  onNewSession: () => void;
}

export const ContextHeader: FC<ContextHeaderProps> = ({ onNewSession }) => {
  const activeTab = useUIStore((s) => s.activeTab);

  // Git state. Branch switching moved into the per-worktree BranchPicker
  // inside WorktreeDetailView — this header just surfaces the current branch
  // name as a read-only identity crumb now.
  const currentBranch = useGitStore((s) => s.currentBranch);
  const repoStatus = useGitStore((s) => s.repoStatus);
  const isPushing = useGitStore((s) => s.isPushing);
  const isPulling = useGitStore((s) => s.isPulling);
  const commitsAhead = useGitStore((s) => s.commitsAhead);
  const fetchChanges = useGitStore((s) => s.fetchChanges);
  const push = useGitStore((s) => s.push);
  const pull = useGitStore((s) => s.pull);

  // File explorer state
  const rootPath = useFileExplorerStore((s) => s.rootPath);
  const selected = useFileExplorerStore((s) => s.selected);
  const startCreating = useFileExplorerStore((s) => s.startCreating);
  const setRootPath = useFileExplorerStore((s) => s.setRootPath);
  const closeFolder = useFileExplorerStore((s) => s.closeFolder);
  const collapseAll = useFileExplorerStore((s) => s.collapseAll);

  const activeWorktree = useActiveWorktree();

  const folderName = rootPath?.split('/').pop() ?? '';
  const isGitRepo = repoStatus?.is_repo ?? false;

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

  // Explorer actions
  const handleNewFile = useCallback(() => {
    const targetDir = getTargetDirectory();
    if (!targetDir) return;
    startCreating(targetDir, 'file');
  }, [getTargetDirectory, startCreating]);

  const handleNewFolder = useCallback(() => {
    const targetDir = getTargetDirectory();
    if (!targetDir) return;
    startCreating(targetDir, 'folder');
  }, [getTargetDirectory, startCreating]);

  const handleRefreshExplorer = useCallback(() => {
    if (rootPath) setRootPath(rootPath);
  }, [rootPath, setRootPath]);

  // Source control actions
  const handlePull = useCallback(async () => {
    try {
      await pull();
      toast.success('Pulled from remote');
    } catch (err) {
      toast.error('Pull failed', { description: String(err) });
    }
  }, [pull]);

  const handlePush = useCallback(async () => {
    try {
      await push();
      toast.success('Pushed to remote');
    } catch (err) {
      toast.error('Push failed', { description: String(err) });
    }
  }, [push]);

  const handleRefreshGit = useCallback(() => {
    fetchChanges();
  }, [fetchChanges]);

  // Determine display name and icon
  const displayName = useMemo(() => {
    if (isGitRepo && currentBranch) return currentBranch;
    if (folderName) return folderName;
    return 'Solo';
  }, [isGitRepo, currentBranch, folderName]);

  const DisplayIcon = isGitRepo ? GitBranch : rootPath ? FolderOpen : null;

  return (
    <div className="relative flex items-center justify-between gap-4 h-9 px-2 shrink-0">
      {/* Left: branch/folder identity crumb (read-only).
          Branch switching moved into the per-worktree BranchPicker inside
          WorktreeDetailView so each worktree owns its own branch context. */}
      <div
        className={cn(
          'flex items-center gap-1.5 h-7 px-2 rounded-lg overflow-hidden max-w-full min-w-0 flex-1',
          'text-xs text-muted-foreground bg-muted/30 cursor-default',
        )}
        title={isGitRepo ? 'Switch branches inside the worktree detail view' : undefined}
      >
        {DisplayIcon && (
          <DisplayIcon
            className={cn('w-3.5 h-3.5 shrink-0', isGitRepo && 'text-primary')}
          />
        )}
        <span className="truncate">{displayName}</span>
        {activeWorktree && (
          <Network className="w-3 h-3 text-primary/60 shrink-0" />
        )}
      </div>

      {/* Right: View-specific actions */}
      <div className="flex items-center gap-0.5 shrink-0">
        {activeTab === 'explorer' && rootPath && (
          <>
            <IconButton onClick={handleNewFile} title="New File" icon={FilePlus} />
            <IconButton onClick={handleNewFolder} title="New Folder" icon={FolderPlus} />
            <IconButton onClick={collapseAll} title="Collapse All" icon={Minimize2} />
            <IconButton onClick={handleRefreshExplorer} title="Refresh" icon={ReloadIcon} />
            <IconButton onClick={closeFolder} title="Close Folder" icon={Cross2Icon} />
          </>
        )}

        {activeTab === 'sessions' && (
          <IconButton onClick={onNewSession} title="New Session" icon={PlusIcon} />
        )}

        {activeTab === 'source-control' && (
          <>
            <IconButton
              onClick={handlePull}
              title="Pull"
              icon={CloudDownload}
              disabled={isPulling || !repoStatus?.has_remote}
              loading={isPulling}
            />
            <IconButton
              onClick={handlePush}
              title={commitsAhead && commitsAhead > 0 ? `Push (${commitsAhead} ahead)` : 'Push'}
              icon={CloudUpload}
              disabled={isPushing || !repoStatus?.has_remote || commitsAhead === 0 || commitsAhead === null}
              loading={isPushing}
              badge={commitsAhead != null && commitsAhead > 0 ? commitsAhead : undefined}
            />
            <IconButton onClick={handleRefreshGit} title="Refresh" icon={ReloadIcon} />
          </>
        )}
      </div>
    </div>
  );
};

// Reusable icon button for header actions
interface IconButtonProps {
  onClick: () => void;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
  loading?: boolean;
  badge?: number;
}

const IconButton: FC<IconButtonProps> = ({ onClick, title, icon: Icon, disabled, loading, badge }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={cn(
      'relative w-6 h-6 flex items-center justify-center rounded-lg',
      'text-muted-foreground hover:bg-muted/60 hover:text-foreground hover:scale-105',
      'disabled:opacity-30 disabled:pointer-events-none',
      'active:scale-95 transition-[transform,background-color,color] duration-200',
    )}
    title={title}
  >
    <Icon className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
    {badge != null && badge > 0 && (
      <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[9px] font-semibold leading-none">
        {badge}
      </span>
    )}
  </button>
);
