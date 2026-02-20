/**
 * ContextHeader - Dynamic header showing branch/folder name + view-specific actions
 */

import { useState, useCallback, useMemo } from 'react';
import type { FC } from 'react';
import {
  GitBranch,
  FolderOpen,
  CaretDown,
  FilePlus,
  FolderPlus,
  ArrowsClockwise,
  X,
  Plus,
  CloudArrowDown,
  CloudArrowUp,
  ArrowsInSimple,
} from '@phosphor-icons/react';
import { useUIStore } from '@/stores/uiStore';
import { useGitStore } from '@/stores/gitStore';
import { useFileExplorerStore, getParentPath } from '@/stores/fileExplorerStore';
import { WorktreeSwitcher } from './WorktreeSwitcher';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface ContextHeaderProps {
  onNewSession: () => void;
}

export const ContextHeader: FC<ContextHeaderProps> = ({ onNewSession }) => {
  const activeTab = useUIStore((s) => s.activeTab);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  // Git state
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
    <div className="flex items-center justify-between h-9 px-2 shrink-0">
      {/* Left: Branch/folder name (clickable) */}
      <div className="relative min-w-0 flex-1">
        <button
          onClick={() => setSwitcherOpen((v) => !v)}
          className={cn(
            'flex items-center gap-1.5 h-7 px-2 rounded-lg min-w-0 max-w-full',
            'text-xs text-muted-foreground',
            'hover:bg-muted/60 hover:text-foreground',
            'active:scale-[0.97] transition-[transform,background-color,color] duration-200',
          )}
        >
          {DisplayIcon && (
            <DisplayIcon
              className={cn('w-3.5 h-3.5 shrink-0', isGitRepo && 'text-primary')}
              weight="bold"
            />
          )}
          <span className="truncate">{displayName}</span>
          {rootPath && <CaretDown className="w-3 h-3 opacity-50 shrink-0" />}
        </button>

        {switcherOpen && (
          <WorktreeSwitcher onClose={() => setSwitcherOpen(false)} />
        )}
      </div>

      {/* Right: View-specific actions */}
      <div className="flex items-center gap-0.5 shrink-0">
        {activeTab === 'explorer' && rootPath && (
          <>
            <IconButton onClick={handleNewFile} title="New File" icon={FilePlus} />
            <IconButton onClick={handleNewFolder} title="New Folder" icon={FolderPlus} />
            <IconButton onClick={collapseAll} title="Collapse All" icon={ArrowsInSimple} />
            <IconButton onClick={handleRefreshExplorer} title="Refresh" icon={ArrowsClockwise} />
            <IconButton onClick={closeFolder} title="Close Folder" icon={X} />
          </>
        )}

        {activeTab === 'sessions' && (
          <IconButton onClick={onNewSession} title="New Session" icon={Plus} />
        )}

        {activeTab === 'source-control' && (
          <>
            <IconButton
              onClick={handlePull}
              title="Pull"
              icon={CloudArrowDown}
              disabled={isPulling || !repoStatus?.has_remote}
              loading={isPulling}
            />
            <IconButton
              onClick={handlePush}
              title={commitsAhead && commitsAhead > 0 ? `Push (${commitsAhead} ahead)` : 'Push'}
              icon={CloudArrowUp}
              disabled={isPushing || !repoStatus?.has_remote || commitsAhead === 0 || commitsAhead === null}
              loading={isPushing}
              badge={commitsAhead != null && commitsAhead > 0 ? commitsAhead : undefined}
            />
            <IconButton onClick={handleRefreshGit} title="Refresh" icon={ArrowsClockwise} />
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
  icon: React.ComponentType<{ className?: string; weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone' }>;
  disabled?: boolean;
  loading?: boolean;
  badge?: number;
}

const IconButton: FC<IconButtonProps> = ({ onClick, title, icon: Icon, disabled, loading, badge }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={cn(
      'relative w-7 h-7 flex items-center justify-center rounded-lg',
      'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      'disabled:opacity-30 disabled:pointer-events-none',
      'active:scale-[0.9] transition-[transform,background-color,color] duration-200',
      loading && 'animate-pulse',
    )}
    title={title}
  >
    <Icon className="w-3.5 h-3.5" weight="bold" />
    {badge != null && badge > 0 && (
      <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[9px] font-semibold leading-none">
        {badge}
      </span>
    )}
  </button>
);
