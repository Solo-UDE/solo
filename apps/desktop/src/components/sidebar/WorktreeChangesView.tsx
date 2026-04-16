/**
 * WorktreeChangesView — Full commit + staging + push UI for worktree detail sidebar.
 */

import { useState, useCallback, useMemo } from 'react';
import type { FC } from 'react';
import {
  CounterClockwiseClockIcon,
  ReloadIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CheckIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
} from '@radix-ui/react-icons';
import { ArrowUp, Loader2, Eye, Rows3, Sparkle } from 'lucide-react';
import { useGitStore } from '@/stores/gitStore';
import { useUIStore } from '@/stores/uiStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import { BUILTIN_PANEL_TYPES } from '@/lib/panels';
import { launchReviewSession } from '@/lib/reviewSession';
import { motion } from 'motion/react';
import { FileChangeItem } from '@/components/source-control/FileChangeItem';
import { AnimatedList } from '@/components/ui/animated-list';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface WorktreeChangesViewProps {
  readonly className?: string;
}

export const WorktreeChangesView: FC<WorktreeChangesViewProps> = ({ className }) => {
  const [stagedOpen, setStagedOpen] = useState(true);
  const [changesOpen, setChangesOpen] = useState(true);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  const [isLaunchingReview, setIsLaunchingReview] = useState(false);

  // Store selectors
  const changedFiles = useGitStore((s) => s.changedFiles);
  const changesSummary = useGitStore((s) => s.changesSummary);
  const commitMessage = useGitStore((s) => s.commitMessage);
  const isCommitting = useGitStore((s) => s.isCommitting);
  const isGeneratingMessage = useGitStore((s) => s.isGeneratingMessage);
  const currentBranch = useGitStore((s) => s.currentBranch);
  const repoStatus = useGitStore((s) => s.repoStatus);
  const isPushing = useGitStore((s) => s.isPushing);
  const commitsAhead = useGitStore((s) => s.commitsAhead);
  const setCommitMessage = useGitStore((s) => s.setCommitMessage);
  const discardFile = useGitStore((s) => s.discardFile);
  const discardAll = useGitStore((s) => s.discardAll);
  const stageFile = useGitStore((s) => s.stageFile);
  const unstageFile = useGitStore((s) => s.unstageFile);
  const commit = useGitStore((s) => s.commit);
  const push = useGitStore((s) => s.push);
  const generateCommitMessage = useGitStore((s) => s.generateCommitMessage);
  const stageAllFiles = useGitStore((s) => s.stageAllFiles);
  const unstageAllFiles = useGitStore((s) => s.unstageAllFiles);

  const devDetailWorktreeId = useUIStore((s) => s.devDetailWorktreeId);
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

  const handleMessageChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setCommitMessage(e.target.value);
    },
    [setCommitMessage],
  );

  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim() || stagedFiles.length === 0) return;
    try {
      await commit(commitMessage.trim());
      toast.success('Changes committed');
    } catch (err) {
      toast.error('Commit failed', { description: String(err) });
    }
  }, [commitMessage, stagedFiles.length, commit]);

  const handleGenerate = useCallback(async () => {
    try {
      await generateCommitMessage();
    } catch (err) {
      toast.error('Failed to generate message', { description: String(err) });
    }
  }, [generateCommitMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleCommit();
      }
    },
    [handleCommit],
  );

  const handlePush = useCallback(async () => {
    try {
      await push();
      toast.success('Pushed to remote');
    } catch (err) {
      toast.error('Push failed', { description: String(err) });
    }
  }, [push]);

  const handleViewBranchDiff = useCallback(() => {
    openPanel(BUILTIN_PANEL_TYPES.BRANCH_DIFF, { branch: currentBranch });
  }, [openPanel, currentBranch]);

  const handleReviewChanges = useCallback(async () => {
    setIsLaunchingReview(true);
    try {
      const sessionId = await launchReviewSession(devDetailWorktreeId ?? undefined);
      openPanel(BUILTIN_PANEL_TYPES.AGENT, { sessionId });
    } catch (err) {
      toast.error('Review failed', { description: String(err) });
    } finally {
      setIsLaunchingReview(false);
    }
  }, [devDetailWorktreeId, openPanel]);

  const handleViewDiff = useCallback(
    (filePath: string) => {
      const fileName = filePath.split('/').pop() ?? filePath;
      openPanel(BUILTIN_PANEL_TYPES.GIT_DIFF, { filePath, fileName });
    },
    [openPanel],
  );

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

  return (
    <div className={cn('flex flex-col h-full', className)}>
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
        <div className="flex gap-1.5 mt-1.5">
          <button
            onClick={handleGenerate}
            disabled={isGeneratingMessage || stagedFiles.length === 0}
            className={cn(
              'h-[34px] px-3 rounded-[10px] text-xs font-medium',
              'flex items-center justify-center gap-1.5',
              'bg-muted/40 text-foreground',
              'hover:bg-muted/60 active:scale-[0.97]',
              'disabled:opacity-40 disabled:pointer-events-none',
              'transition-[transform,background-color] duration-200',
            )}
            title="Generate commit message with AI"
          >
            {isGeneratingMessage ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkle className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            onClick={handleCommit}
            disabled={!commitMessage.trim() || isCommitting || stagedFiles.length === 0}
            className={cn(
              'flex-1 h-[34px] rounded-[10px] text-xs font-medium',
              'flex items-center justify-center gap-1.5',
              'bg-primary text-primary-foreground',
              'hover:brightness-110 active:scale-[0.97]',
              'disabled:opacity-40 disabled:pointer-events-none',
              'transition-[transform,background-color,color] duration-200',
            )}
            title={stagedFiles.length === 0 ? 'Stage files before committing' : 'Commit staged changes (Cmd+Enter)'}
          >
            {isCommitting ? (
              <ReloadIcon className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <CheckIcon className="w-3.5 h-3.5" />
            )}
            {isCommitting ? 'Committing...' : 'Commit'}
          </button>
        </div>

        {/* Push button (shown when remote exists and commits ahead) */}
        {repoStatus?.has_remote && (
          <button
            onClick={handlePush}
            disabled={isPushing || !commitsAhead}
            className={cn(
              'w-full h-[34px] mt-1.5 rounded-[10px] text-xs font-medium',
              'flex items-center justify-center gap-1.5',
              'bg-muted/40 text-foreground',
              'hover:bg-muted/60 active:scale-[0.97]',
              'disabled:opacity-40 disabled:pointer-events-none',
              'transition-[transform,background-color] duration-200',
            )}
            title={commitsAhead ? `Push ${commitsAhead} commit${commitsAhead !== 1 ? 's' : ''} to remote` : 'Nothing to push'}
          >
            {isPushing ? (
              <ReloadIcon className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ArrowUp className="w-3.5 h-3.5" />
            )}
            {isPushing ? 'Pushing...' : 'Push'}
            {commitsAhead != null && commitsAhead > 0 && (
              <span className="px-1 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary">
                {commitsAhead}
              </span>
            )}
          </button>
        )}
      </div>

      {/* File count + review icons */}
      <div className="flex items-center justify-between px-3 pb-1">
        <span className="text-[10px] text-muted-foreground/60">
          {changedFiles.length} file{changedFiles.length !== 1 ? 's' : ''} changed
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleReviewChanges}
            disabled={isLaunchingReview || changedFiles.length === 0}
            className={cn(
              'h-5 w-5 flex items-center justify-center rounded',
              'text-muted-foreground hover:text-foreground hover:bg-muted/60',
              'disabled:opacity-40 disabled:pointer-events-none',
              'active:scale-95 transition-all duration-150',
            )}
            title="AI review changes (Opus)"
          >
            {isLaunchingReview ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <MagnifyingGlassIcon className="w-3 h-3" />
            )}
          </button>
          <button
            onClick={handleViewBranchDiff}
            className={cn(
              'h-5 w-5 flex items-center justify-center rounded',
              'text-muted-foreground hover:text-foreground hover:bg-muted/60',
              'active:scale-95 transition-all duration-150',
            )}
            title="View all changes"
          >
            <Eye className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* File sections */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {/* Staged Changes Section */}
        {stagedFiles.length > 0 && (
          <>
            <button
              onClick={() => setStagedOpen((prev) => !prev)}
              className={cn(
                'group flex items-center gap-1.5 h-7 px-3 shrink-0',
                'text-xs font-medium text-muted-foreground',
                'hover:text-foreground transition-colors duration-150',
              )}
            >
              {stagedOpen ? (
                <ChevronDownIcon className="w-3 h-3" />
              ) : (
                <ChevronRightIcon className="w-3 h-3" />
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
                <MinusIcon
                  className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground transition-colors"
                />
              </span>
            </button>

            {stagedOpen && (
              <AnimatedList className="overflow-y-auto px-1">
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
              </AnimatedList>
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
            <ChevronDownIcon className="w-3 h-3" />
          ) : (
            <ChevronRightIcon className="w-3 h-3" />
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
          <span className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {changedFiles.length > 0 && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  handleViewBranchDiff();
                }}
                title="View all branch changes"
              >
                <Rows3
                  className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground transition-colors"
                />
              </span>
            )}
            {unstagedFiles.length > 0 && (
              <>
                <span onClick={handleStageAll}>
                  <PlusIcon
                    className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground transition-colors"
                  />
                </span>
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDiscardAll();
                  }}
                >
                  <CounterClockwiseClockIcon
                    className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive transition-colors"
                  />
                </span>
              </>
            )}
          </span>
        </button>

        {/* Unstaged file list */}
        {changesOpen && (
          <div className="flex-1 overflow-y-auto px-1">
            {unstagedFiles.length === 0 ? (
              <motion.div
                className="flex flex-col items-center py-6 gap-1"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.15 }}
              >
                <CheckIcon className="w-4 h-4 text-muted-foreground/30 mb-0.5" />
                <p className="text-[11px] text-muted-foreground/50">No changes detected</p>
              </motion.div>
            ) : (
              <AnimatedList>
                {unstagedFiles.map((file) => (
                  <FileChangeItem
                    key={file.path}
                    file={file}
                    onDiscard={handleDiscardFile}
                    onViewDiff={handleViewDiff}
                    onStage={handleStageFile}
                    onUnstage={handleUnstageFile}
                  />
                ))}
              </AnimatedList>
            )}
          </div>
        )}
      </div>

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
