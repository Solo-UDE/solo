/**
 * SourceControlPanel — main sidebar panel for git source control
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import type { FC } from 'react';
import {
  ArrowDown,
  ArrowsClockwise,
  ArrowCounterClockwise,
  ArrowUp,
  CaretDown,
  CaretRight,
  Check,
  CircleNotch,
  CloudArrowDown,
  GitBranch,
  GithubLogo,
  Minus,
  Plus,
  Sparkle,
  TreeStructure,
} from '@phosphor-icons/react';
import { useGitStore } from '@/stores/gitStore';
import { useGitHubAccountsStore } from '@/stores/githubAccountsStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import { useWorktreeList } from '@/stores/worktreeStore';
import { BUILTIN_PANEL_TYPES } from '@/lib/panels';
import { motion } from 'motion/react';
import { BranchSelector } from './BranchSelector';
import { FileChangeItem } from './FileChangeItem';
import { GitHubSetup } from './GitHubSetup';
import { WorktreePanel } from '../sidebar/WorktreePanel';
import { AnimatedList } from '../ui/animated-list';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface SourceControlPanelProps {
  readonly className?: string;
}

export const SourceControlPanel: FC<SourceControlPanelProps> = ({ className }) => {
  const [stagedOpen, setStagedOpen] = useState(true);
  const [changesOpen, setChangesOpen] = useState(true);
  const [worktreesOpen, setWorktreesOpen] = useState(true);
  const worktrees = useWorktreeList();
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
  const isCommitting = useGitStore((s) => s.isCommitting);
  const isPushing = useGitStore((s) => s.isPushing);
  const isPulling = useGitStore((s) => s.isPulling);
  const isFetching = useGitStore((s) => s.isFetching);
  const isGeneratingMessage = useGitStore((s) => s.isGeneratingMessage);
  const commitsAhead = useGitStore((s) => s.commitsAhead);
  const setCommitMessage = useGitStore((s) => s.setCommitMessage);
  const startPolling = useGitStore((s) => s.startPolling);
  const stopPolling = useGitStore((s) => s.stopPolling);
  const discardFile = useGitStore((s) => s.discardFile);
  const discardAll = useGitStore((s) => s.discardAll);
  const stageFile = useGitStore((s) => s.stageFile);
  const unstageFile = useGitStore((s) => s.unstageFile);
  const commit = useGitStore((s) => s.commit);
  const push = useGitStore((s) => s.push);
  const pull = useGitStore((s) => s.pull);
  const fetch = useGitStore((s) => s.fetch);
  const generateCommitMessage = useGitStore((s) => s.generateCommitMessage);
  const stageAllFiles = useGitStore((s) => s.stageAllFiles);
  const unstageAllFiles = useGitStore((s) => s.unstageAllFiles);
  const ghToken = useGitHubAccountsStore((s) => s.token);
  const connectGitHub = useGitHubAccountsStore((s) => s.connectGitHub);

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

  // Standalone Commit (local only)
  const handleCommit = useCallback(async () => {
    if (!commitMessage.trim() || stagedFiles.length === 0) return;
    try {
      await commit(commitMessage.trim());
      toast.success('Changes committed');
    } catch (err) {
      toast.error('Commit failed', { description: String(err) });
    }
  }, [commitMessage, stagedFiles.length, commit]);

  // Push
  const handlePush = useCallback(async () => {
    if (!ghToken) {
      try { await connectGitHub(); } catch { return; }
    }
    try {
      await push();
      toast.success('Pushed to GitHub');
    } catch (err) {
      toast.error('Push failed', { description: String(err) });
    }
  }, [ghToken, connectGitHub, push]);

  // Pull
  const handlePull = useCallback(async () => {
    if (!ghToken) {
      try { await connectGitHub(); } catch { return; }
    }
    try {
      await pull();
      toast.success('Pulled from GitHub');
    } catch (err) {
      toast.error('Pull failed', { description: String(err) });
    }
  }, [ghToken, connectGitHub, pull]);

  // Fetch
  const handleFetch = useCallback(async () => {
    if (!ghToken) {
      try { await connectGitHub(); } catch { return; }
    }
    try {
      await fetch();
      toast.success('Fetched from remote');
    } catch (err) {
      toast.error('Fetch failed', { description: String(err) });
    }
  }, [ghToken, connectGitHub, fetch]);

  // Generate commit message via AI
  const handleGenerate = useCallback(async () => {
    try {
      await generateCommitMessage();
    } catch (err) {
      toast.error('Failed to generate message', { description: String(err) });
    }
  }, [generateCommitMessage]);

  // Handle Cmd+Enter in commit textarea — triggers commit (not push)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleCommit();
      }
    },
    [handleCommit],
  );

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
      {/* Empty state for non-git repos */}
      {isNotRepo && (
        <motion.div
          className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-3"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        >
          <div className="w-10 h-10 rounded-2xl bg-muted/50 flex items-center justify-center">
            <GitBranch className="w-5 h-5 text-muted-foreground/40" />
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Not a git repository</p>
            <p className="text-[11px] text-muted-foreground/50 leading-relaxed">
              Open a folder with a <span className="text-muted-foreground/70">.git</span> directory, or initialize one.
            </p>
          </div>
        </motion.div>
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
                  <CircleNotch className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkle className="w-3.5 h-3.5" weight="bold" />
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
                  <ArrowsClockwise className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" weight="bold" />
                )}
                {isCommitting ? 'Committing...' : 'Commit'}
              </button>
            </div>
          </div>

          {/* Fetch / Pull / Push buttons (shown when remote exists) */}
          {repoStatus.has_remote && (
            <div className="flex gap-1.5 px-3 pb-2">
              <button
                onClick={handleFetch}
                disabled={isFetching || isPulling || isPushing}
                className={cn(
                  'flex-1 h-[30px] rounded-[10px] text-xs font-medium',
                  'flex items-center justify-center gap-1.5',
                  'bg-muted/40 text-foreground',
                  'hover:bg-muted/60 active:scale-[0.97]',
                  'disabled:opacity-40 disabled:pointer-events-none',
                  'transition-[transform,background-color] duration-200',
                )}
                title="Fetch from remote"
              >
                {isFetching ? (
                  <ArrowsClockwise className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CloudArrowDown className="w-3.5 h-3.5" weight="bold" />
                )}
                Fetch
              </button>
              <button
                onClick={handlePull}
                disabled={isPulling || isPushing || isFetching}
                className={cn(
                  'flex-1 h-[30px] rounded-[10px] text-xs font-medium',
                  'flex items-center justify-center gap-1.5',
                  'bg-muted/40 text-foreground',
                  'hover:bg-muted/60 active:scale-[0.97]',
                  'disabled:opacity-40 disabled:pointer-events-none',
                  'transition-[transform,background-color] duration-200',
                )}
                title="Pull from remote"
              >
                {isPulling ? (
                  <ArrowsClockwise className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ArrowDown className="w-3.5 h-3.5" weight="bold" />
                )}
                Pull
              </button>
              <button
                onClick={handlePush}
                disabled={isPushing || isPulling || isFetching}
                className={cn(
                  'flex-1 h-[30px] rounded-[10px] text-xs font-medium',
                  'flex items-center justify-center gap-1.5',
                  'bg-muted/40 text-foreground',
                  'hover:bg-muted/60 active:scale-[0.97]',
                  'disabled:opacity-40 disabled:pointer-events-none',
                  'transition-[transform,background-color] duration-200',
                )}
                title="Push to remote"
              >
                {isPushing ? (
                  <ArrowsClockwise className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ArrowUp className="w-3.5 h-3.5" weight="bold" />
                )}
                Push
                {commitsAhead != null && commitsAhead > 0 && (
                  <span className="px-1 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary">
                    {commitsAhead}
                  </span>
                )}
              </button>
            </div>
          )}

          {/* GitHub connect prompt when remote exists but no token */}
          {repoStatus.has_remote && !ghToken && (
            <div className="px-3 pb-2">
              <button
                onClick={() => connectGitHub()}
                className={cn(
                  'w-full h-[30px] rounded-[10px] text-xs font-medium',
                  'flex items-center justify-center gap-1.5',
                  'bg-muted/30 text-muted-foreground',
                  'hover:bg-muted/50 active:scale-[0.97]',
                  'transition-[transform,background-color] duration-200',
                )}
              >
                <GithubLogo className="w-3.5 h-3.5" weight="bold" />
                Sign in to push &amp; pull
              </button>
            </div>
          )}

          {/* GitHub Setup when no remote */}
          {!repoStatus.has_remote && <GitHubSetup className="px-3 pb-2" />}

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
                  <motion.div
                    className="flex flex-col items-center py-6 gap-1"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.15 }}
                  >
                    <Check className="w-4 h-4 text-muted-foreground/30 mb-0.5" weight="bold" />
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

            {/* Worktrees section — hidden when only the default worktree exists */}
            {worktrees.length > 1 && (
              <>
                <button
                  onClick={() => setWorktreesOpen((prev) => !prev)}
                  className={cn(
                    'group flex items-center gap-1.5 h-7 px-3 shrink-0',
                    'text-xs font-medium text-muted-foreground',
                    'hover:text-foreground transition-colors duration-150',
                  )}
                >
                  {worktreesOpen ? (
                    <CaretDown className="w-3 h-3" weight="bold" />
                  ) : (
                    <CaretRight className="w-3 h-3" weight="bold" />
                  )}
                  <TreeStructure className="w-3 h-3" />
                  Worktrees
                  <span
                    className={cn(
                      'ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold',
                      'bg-primary/10 text-primary',
                    )}
                  >
                    {worktrees.length}
                  </span>
                </button>
                {worktreesOpen && (
                  <WorktreePanel embedded className="px-0" />
                )}
              </>
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
