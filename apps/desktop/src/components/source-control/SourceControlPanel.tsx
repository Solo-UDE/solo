/**
 * SourceControlPanel — main sidebar panel for git source control
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import type { FC } from 'react';
import {
  ArrowsClockwise,
  ArrowCounterClockwise,
  CaretDown,
  CaretRight,
  CloudArrowUp,
  GitBranch,
  Minus,
  Plus,
} from '@phosphor-icons/react';
import { useGitStore } from '@/stores/gitStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import { BUILTIN_PANEL_TYPES } from '@/lib/panels';
import { BranchSelector } from './BranchSelector';
import { FileChangeItem } from './FileChangeItem';
import { ConfirmDialog } from './ConfirmDialog';
import { cn } from '@/lib/utils';

interface SourceControlPanelProps {
  readonly className?: string;
}

export const SourceControlPanel: FC<SourceControlPanelProps> = ({ className }) => {
  const [stagedOpen, setStagedOpen] = useState(true);
  const [changesOpen, setChangesOpen] = useState(true);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  // Store selectors
  const repoStatus = useGitStore((s) => s.repoStatus);
  const changedFiles = useGitStore((s) => s.changedFiles);
  const changesSummary = useGitStore((s) => s.changesSummary);
  const commitMessage = useGitStore((s) => s.commitMessage);
  const isPushing = useGitStore((s) => s.isPushing);
  const isPulling = useGitStore((s) => s.isPulling);
  const setCommitMessage = useGitStore((s) => s.setCommitMessage);
  const startPolling = useGitStore((s) => s.startPolling);
  const stopPolling = useGitStore((s) => s.stopPolling);
  const fetchChanges = useGitStore((s) => s.fetchChanges);
  const discardFile = useGitStore((s) => s.discardFile);
  const discardAll = useGitStore((s) => s.discardAll);
  const stageFile = useGitStore((s) => s.stageFile);
  const unstageFile = useGitStore((s) => s.unstageFile);
  const stageAllFiles = useGitStore((s) => s.stageAllFiles);
  const unstageAllFiles = useGitStore((s) => s.unstageAllFiles);

  const openPanel = useMemo(() => usePanelTabsStore.getState().openPanel, []);

  // Split files into staged and unstaged
  const stagedFiles = useMemo(
    () => changedFiles.filter((f) => f.is_staged),
    [changedFiles],
  );
  const unstagedFiles = useMemo(
    () => changedFiles.filter((f) => !f.is_staged),
    [changedFiles],
  );

  // Start polling when mounted
  useEffect(() => {
    startPolling();
    return () => stopPolling();
  }, [startPolling, stopPolling]);

  // Handle commit message change
  const handleMessageChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setCommitMessage(e.target.value);
    },
    [setCommitMessage],
  );

  // Handle Cmd+Enter in commit textarea
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        // TODO: Push when GitHub integration is wired
      }
    },
    [],
  );

  // Refresh
  const handleRefresh = useCallback(() => {
    fetchChanges();
  }, [fetchChanges]);

  // View file diff
  const handleViewDiff = useCallback(
    (filePath: string) => {
      const fileName = filePath.split('/').pop() ?? filePath;
      openPanel(BUILTIN_PANEL_TYPES.GIT_DIFF, { filePath, fileName });
    },
    [openPanel],
  );

  // Discard single file (with confirmation)
  const handleDiscardFile = useCallback(
    (filePath: string) => {
      const fileName = filePath.split('/').pop() ?? filePath;
      setConfirmDialog({
        isOpen: true,
        title: 'Discard Changes',
        message: `Are you sure you want to discard changes to "${fileName}"? This cannot be undone.`,
        onConfirm: () => {
          setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
          discardFile(filePath).catch((err) => {
            console.error('Failed to discard file:', err);
          });
        },
      });
    },
    [discardFile],
  );

  // Discard all (with confirmation)
  const handleDiscardAll = useCallback(() => {
    setConfirmDialog({
      isOpen: true,
      title: 'Discard All Changes',
      message: `Are you sure you want to discard all ${unstagedFiles.length} changed files? This cannot be undone.`,
      onConfirm: () => {
        setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
        discardAll().catch((err) => {
          console.error('Failed to discard all:', err);
        });
      },
    });
  }, [unstagedFiles.length, discardAll]);

  // Stage/Unstage handlers
  const handleStageFile = useCallback(
    (filePath: string) => {
      stageFile(filePath).catch((err) => {
        console.error('Failed to stage file:', err);
      });
    },
    [stageFile],
  );

  const handleUnstageFile = useCallback(
    (filePath: string) => {
      unstageFile(filePath).catch((err) => {
        console.error('Failed to unstage file:', err);
      });
    },
    [unstageFile],
  );

  const handleStageAll = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      stageAllFiles().catch((err) => {
        console.error('Failed to stage all:', err);
      });
    },
    [stageAllFiles],
  );

  const handleUnstageAll = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      unstageAllFiles().catch((err) => {
        console.error('Failed to unstage all:', err);
      });
    },
    [unstageAllFiles],
  );

  const closeConfirmDialog = useCallback(() => {
    setConfirmDialog((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const isNotRepo = repoStatus && !repoStatus.is_repo;

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 shrink-0">
        <BranchSelector />
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleRefresh}
            disabled={isPulling}
            className={cn(
              'w-7 h-7 flex items-center justify-center rounded-lg',
              'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              'active:scale-[0.9] transition-all duration-200',
              isPulling && 'animate-spin',
            )}
            title="Refresh"
          >
            <ArrowsClockwise className="w-3.5 h-3.5" weight="bold" />
          </button>
        </div>
      </div>

      {/* Empty state for non-git repos */}
      {isNotRepo && (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <GitBranch className="w-10 h-10 text-muted-foreground/30 mb-3" />
          <p className="text-xs text-muted-foreground/60 leading-relaxed">
            This workspace is not a git repository. Open a folder that contains a{' '}
            <span className="text-muted-foreground">.git</span> directory, or initialize one.
          </p>
        </div>
      )}

      {/* Main content */}
      {repoStatus?.is_repo && (
        <>
          {/* Commit Section */}
          <div className="px-3 pb-2 shrink-0">
            <textarea
              value={commitMessage}
              onChange={handleMessageChange}
              onKeyDown={handleKeyDown}
              placeholder="Commit message..."
              className={cn(
                'w-full h-[72px] px-3 py-2 rounded-lg text-xs resize-none',
                'bg-muted/40 border-none text-foreground placeholder:text-muted-foreground/50',
                'focus:bg-muted/60 focus:ring-1 focus:ring-ring/30 focus:outline-none',
                'transition-colors duration-150',
              )}
            />
            <button
              disabled={!commitMessage.trim() || isPushing || stagedFiles.length === 0}
              className={cn(
                'w-full h-[34px] mt-1.5 rounded-[10px] text-xs font-medium',
                'flex items-center justify-center gap-1.5',
                'bg-primary text-primary-foreground',
                'hover:brightness-110 active:scale-[0.97]',
                'disabled:opacity-40 disabled:pointer-events-none',
                'transition-all duration-200',
              )}
              title={stagedFiles.length === 0 ? 'Stage files before committing' : undefined}
            >
              {isPushing ? (
                <ArrowsClockwise className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CloudArrowUp className="w-3.5 h-3.5" weight="bold" />
              )}
              {isPushing ? 'Pushing...' : 'Commit & Push'}
            </button>
          </div>

          {/* Staged Changes Section */}
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {stagedFiles.length > 0 && (
              <>
                {/* Staged header */}
                <button
                  onClick={() => setStagedOpen((prev) => !prev)}
                  className={cn(
                    'group flex items-center gap-1.5 h-7 px-3 shrink-0',
                    'text-xs font-medium text-muted-foreground',
                    'hover:text-foreground transition-colors duration-150',
                  )}
                >
                  {stagedOpen ? (
                    <CaretDown className="w-3 h-3" weight="bold" />
                  ) : (
                    <CaretRight className="w-3 h-3" weight="bold" />
                  )}
                  Staged Changes
                  <span
                    className={cn(
                      'ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold',
                      'bg-emerald-400/10 text-emerald-400',
                    )}
                  >
                    {stagedFiles.length}
                  </span>
                  <span
                    className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={handleUnstageAll}
                  >
                    <Minus
                      className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground transition-colors"
                      weight="bold"
                    />
                  </span>
                </button>

                {/* Staged file list */}
                {stagedOpen && (
                  <div className="overflow-y-auto px-1">
                    {stagedFiles.map((file) => (
                      <FileChangeItem
                        key={`staged-${file.path}`}
                        file={file}
                        onDiscard={handleDiscardFile}
                        onViewDiff={handleViewDiff}
                        onStage={handleStageFile}
                        onUnstage={handleUnstageFile}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Changes header */}
            <button
              onClick={() => setChangesOpen((prev) => !prev)}
              className={cn(
                'group flex items-center gap-1.5 h-7 px-3 shrink-0',
                'text-xs font-medium text-muted-foreground',
                'hover:text-foreground transition-colors duration-150',
              )}
            >
              {changesOpen ? (
                <CaretDown className="w-3 h-3" weight="bold" />
              ) : (
                <CaretRight className="w-3 h-3" weight="bold" />
              )}
              Changes
              {unstagedFiles.length > 0 && (
                <span
                  className={cn(
                    'ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold',
                    'bg-primary/10 text-primary',
                  )}
                >
                  {unstagedFiles.length}
                </span>
              )}
              {changesSummary && (changesSummary.insertions > 0 || changesSummary.deletions > 0) && (
                <span className="ml-1 flex items-center gap-1 text-[10px]">
                  {changesSummary.insertions > 0 && (
                    <span className="text-emerald-400">+{changesSummary.insertions}</span>
                  )}
                  {changesSummary.deletions > 0 && (
                    <span className="text-red-400">-{changesSummary.deletions}</span>
                  )}
                </span>
              )}
              {unstagedFiles.length > 0 && (
                <span className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span onClick={handleStageAll}>
                    <Plus
                      className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground transition-colors"
                      weight="bold"
                    />
                  </span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDiscardAll();
                    }}
                  >
                    <ArrowCounterClockwise
                      className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive transition-colors"
                      weight="bold"
                    />
                  </span>
                </span>
              )}
            </button>

            {/* Unstaged file list */}
            {changesOpen && (
              <div className="flex-1 overflow-y-auto px-1">
                {unstagedFiles.length === 0 ? (
                  <div className="px-3 py-4 text-center">
                    <p className="text-[11px] text-muted-foreground/50">No changes detected</p>
                  </div>
                ) : (
                  unstagedFiles.map((file) => (
                    <FileChangeItem
                      key={file.path}
                      file={file}
                      onDiscard={handleDiscardFile}
                      onViewDiff={handleViewDiff}
                      onStage={handleStageFile}
                      onUnstage={handleUnstageFile}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* Confirm dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel="Discard"
        onConfirm={confirmDialog.onConfirm}
        onCancel={closeConfirmDialog}
      />
    </div>
  );
};
