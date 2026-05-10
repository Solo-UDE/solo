/**
 * WorktreePanel - Sidebar panel for managing git worktrees
 */

import { useCallback, useEffect, useState } from 'react';
import type { FC } from 'react';
import { PlusIcon, LockClosedIcon, LockOpen1Icon, TrashIcon } from '@radix-ui/react-icons';
import { Network, Loader2, Brush, GitCompareArrows, ArrowUpFromLine, Bot } from 'lucide-react';
import { motion } from 'motion/react';
import { ListSkeleton } from '@/components/ui/skeletons';
import { useWorktreeStore, useWorktreeList } from '@/stores/worktreeStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import { BUILTIN_PANEL_TYPES } from '@/lib/panels';
import { promote as promoteWorktree } from '@/lib/tauri/worktree';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { WorktreeInfo } from '../../bindings';
import { VirtualList, VirtualTextLines } from '@/components/ui/virtual-list';

interface WorktreePanelProps {
  className?: string;
  /** When true, hides the header bar (parent provides the section header) */
  embedded?: boolean;
  /** Parent-controlled create form visibility (for embedded mode) */
  showCreate?: boolean;
  /** Callback when create form visibility changes internally */
  onShowCreateChange?: (show: boolean) => void;
}

export const WorktreePanel: FC<WorktreePanelProps> = ({ className, embedded, showCreate, onShowCreateChange }) => {
  const worktrees = useWorktreeList();
  const activeWorktreeId = useWorktreeStore((s) => s.activeWorktreeId);
  const isLoading = useWorktreeStore((s) => s.isLoading);
  const error = useWorktreeStore((s) => s.error);
  const loadWorktrees = useWorktreeStore((s) => s.loadWorktrees);
  const createWorktree = useWorktreeStore((s) => s.createWorktree);
  const removeWorktree = useWorktreeStore((s) => s.removeWorktree);
  const setActive = useWorktreeStore((s) => s.setActive);
  const lock = useWorktreeStore((s) => s.lock);
  const unlock = useWorktreeStore((s) => s.unlock);
  const pruneWorktrees = useWorktreeStore((s) => s.pruneWorktrees);
  const clearError = useWorktreeStore((s) => s.clearError);
  const setupProgress = useWorktreeStore((s) => s.setupProgress);
  const startAgentInWorktree = useWorktreeStore((s) => s.startAgentInWorktree);

  // Controlled/uncontrolled pattern for create form visibility
  const [internalShowCreate, setInternalShowCreate] = useState(false);
  const showCreateForm = showCreate !== undefined ? showCreate : internalShowCreate;
  const setShowCreateForm = (show: boolean) => {
    if (onShowCreateChange) onShowCreateChange(show);
    setInternalShowCreate(show);
  };
  const [branchName, setBranchName] = useState('');
  const [createBranch, setCreateBranch] = useState(true);
  const [baseBranch, setBaseBranch] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [promoteId, setPromoteId] = useState<string | null>(null);

  // Load worktrees on mount
  useEffect(() => {
    loadWorktrees();
  }, [loadWorktrees]);

  const handleCreate = useCallback(async () => {
    if (!branchName.trim()) return;
    setIsCreating(true);
    try {
      await createWorktree(branchName.trim(), createBranch, baseBranch || undefined);
      setBranchName('');
      setBaseBranch('');
      setShowCreateForm(false);
    } catch {
      // Error is set in the store
    } finally {
      setIsCreating(false);
    }
  }, [branchName, createBranch, baseBranch, createWorktree]);

  const handleCreateAndRunAgent = useCallback(async () => {
    if (!branchName.trim()) return;
    setIsCreating(true);
    try {
      const sessionId = await startAgentInWorktree(branchName.trim());
      setBranchName('');
      setBaseBranch('');
      setShowCreateForm(false);
      usePanelTabsStore.getState().openPanel(BUILTIN_PANEL_TYPES.AGENT, { sessionId });
      toast.success('Worktree created with agent session');
    } catch (err) {
      toast.error('Failed to create worktree', { description: String(err) });
    } finally {
      setIsCreating(false);
    }
  }, [branchName, startAgentInWorktree]);

  const handleViewDiff = useCallback((wt: WorktreeInfo) => {
    usePanelTabsStore.getState().openPanel(BUILTIN_PANEL_TYPES.WORKTREE_DIFF, {
      worktreeId: wt.id,
      branch: wt.branch ?? wt.id,
    });
  }, []);

  const handlePromote = useCallback(async (worktreeId: string, newBranchName: string) => {
    try {
      await promoteWorktree(worktreeId, newBranchName);
      await loadWorktrees();
      setPromoteId(null);
      toast.success(`Promoted to branch "${newBranchName}"`);
    } catch (err) {
      toast.error('Promote failed', { description: String(err) });
    }
  }, [loadWorktrees]);

  const handleRemove = useCallback(async (id: string, isLocked: boolean) => {
    await removeWorktree(id, isLocked);
  }, [removeWorktree]);

  const handleToggleLock = useCallback(async (wt: WorktreeInfo) => {
    if (wt.is_locked) {
      await unlock(wt.id);
    } else {
      await lock(wt.id, 'Locked from sidebar');
    }
  }, [lock, unlock]);

  const handleSetActive = useCallback(async (id: string) => {
    const newId = id === 'main' ? null : id;
    await setActive(newId);
  }, [setActive]);

  // Count stale worktrees (non-main, non-locked)
  const staleCount = worktrees.filter((wt) => !wt.is_main && !wt.is_locked).length;

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Header (hidden when embedded — parent provides its own) */}
      {!embedded && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Worktrees
          </span>
          <div className="flex items-center gap-1">
            {staleCount > 0 && pruneWorktrees && (
              <button
                onClick={() => pruneWorktrees()}
                className="p-1 rounded hover:bg-muted/60 transition-colors"
                title={`Prune stale worktrees (${staleCount})`}
              >
                <Brush className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            )}
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="p-1 rounded hover:bg-muted/60 transition-colors"
              title="Create worktree"
            >
              <PlusIcon className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="px-3 py-1.5 bg-destructive/10 border-b border-destructive/20">
          <div className="flex items-center justify-between">
            <span className="text-xs text-destructive truncate">{error}</span>
            <button onClick={clearError} className="text-xs text-destructive hover:underline ml-2 shrink-0">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Create form */}
      {showCreateForm && (
        <div className="px-3 py-2 border-b border-border/30 space-y-2">
          <input
            type="text"
            placeholder="Branch name"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            className="w-full h-7 px-2 text-xs bg-muted/30 border border-border/50 rounded outline-none focus:ring-1 focus:ring-ring"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={createBranch}
                onChange={(e) => setCreateBranch(e.target.checked)}
                className="rounded"
              />
              New branch
            </label>
            {createBranch && (
              <input
                type="text"
                placeholder="Base (default: HEAD)"
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
                className="flex-1 h-6 px-2 text-xs bg-muted/30 border border-border/50 rounded outline-none focus:ring-1 focus:ring-ring"
              />
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreate}
              disabled={!branchName.trim() || isCreating}
              className="h-6 px-3 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
            >
              {isCreating ? 'Creating...' : 'Create'}
            </button>
            <button
              onClick={handleCreateAndRunAgent}
              disabled={!branchName.trim() || isCreating}
              className="h-6 px-3 text-xs bg-muted/60 text-foreground rounded hover:bg-muted/80 disabled:opacity-50 flex items-center gap-1"
              title="Create worktree and start an agent session in it"
            >
              <Bot className="w-3 h-3" />
              {isCreating ? '...' : '+ Agent'}
            </button>
            <button
              onClick={() => setShowCreateForm(false)}
              className="h-6 px-3 text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Worktree list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && worktrees.length === 0 ? (
          <ListSkeleton rows={3} />
        ) : worktrees.length === 0 ? (
          <motion.div
            className="flex flex-col items-center justify-center py-8 text-center px-4"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          >
            <div className="w-10 h-10 rounded-2xl bg-muted/50 flex items-center justify-center mb-2">
              <Network className="w-5 h-5 text-muted-foreground/40" />
            </div>
            <p className="text-xs font-medium text-muted-foreground">No worktrees yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Create one to run agents in isolated branches
            </p>
          </motion.div>
        ) : (
          <VirtualList
            items={worktrees}
            estimateSize={() => 62}
            overscan={8}
            className="h-full py-1"
            getItemKey={(wt) => wt.id}
            testId="worktree-panel-list"
            renderItem={(wt) => (
              <WorktreeCard
                worktree={wt}
                isActive={wt.is_main ? activeWorktreeId === null : activeWorktreeId === wt.id}
                setupLines={setupProgress.get(wt.id)}
                isPromoting={promoteId === wt.id}
                onSelect={() => handleSetActive(wt.id)}
                onToggleLock={() => handleToggleLock(wt)}
                onRemove={() => handleRemove(wt.id, wt.is_locked)}
                onViewDiff={() => handleViewDiff(wt)}
                onPromoteToggle={() => setPromoteId(promoteId === wt.id ? null : wt.id)}
                onPromote={(name) => handlePromote(wt.id, name)}
              />
            )}
          />
        )}
      </div>
    </div>
  );
};

// Individual worktree card
interface WorktreeCardProps {
  worktree: WorktreeInfo;
  isActive: boolean;
  setupLines?: string[];
  isPromoting: boolean;
  onSelect: () => void;
  onToggleLock: () => void;
  onRemove: () => void;
  onViewDiff: () => void;
  onPromoteToggle: () => void;
  onPromote: (branchName: string) => void;
}

const WorktreeCard: FC<WorktreeCardProps> = ({
  worktree,
  isActive,
  setupLines,
  isPromoting,
  onSelect,
  onToggleLock,
  onRemove,
  onViewDiff,
  onPromoteToggle,
  onPromote,
}) => {
  const [showSetup, setShowSetup] = useState(false);
  const [promoteBranch, setPromoteBranch] = useState(worktree.branch ?? worktree.id);
  const isSettingUp = setupLines && setupLines.length > 0 && !setupLines[setupLines.length - 1]?.includes('Setup complete');

  return (
    <div
      className={cn(
        'group mx-1 px-2 py-1.5 rounded cursor-pointer transition-colors',
        isActive ? 'bg-accent/50' : 'hover:bg-muted/40',
      )}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          {isSettingUp && (
            <Loader2 className="w-3 h-3 text-primary animate-spin shrink-0" />
          )}
          <span className={cn(
            'text-xs truncate',
            worktree.is_main ? 'font-medium' : '',
            isActive ? 'text-foreground' : 'text-muted-foreground',
          )}>
            {worktree.is_main ? 'main' : (worktree.branch ?? worktree.id)}
          </span>
          {worktree.is_locked && (
            <LockClosedIcon className="w-3 h-3 text-warning shrink-0" />
          )}
          {worktree.is_dirty && (
            <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" title="Uncommitted changes" />
          )}
        </div>

        {/* Actions (visible on hover, hidden for main) */}
        {!worktree.is_main && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); onViewDiff(); }}
              className="p-0.5 rounded hover:bg-muted/60"
              title="View diff from base"
            >
              <GitCompareArrows className="w-3 h-3 text-muted-foreground" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onPromoteToggle(); }}
              className="p-0.5 rounded hover:bg-muted/60"
              title="Promote to branch"
            >
              <ArrowUpFromLine className="w-3 h-3 text-muted-foreground" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onToggleLock(); }}
              className="p-0.5 rounded hover:bg-muted/60"
              title={worktree.is_locked ? 'Unlock' : 'Lock'}
            >
              {worktree.is_locked
                ? <LockOpen1Icon className="w-3 h-3 text-muted-foreground" />
                : <LockClosedIcon className="w-3 h-3 text-muted-foreground" />
              }
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              className="p-0.5 rounded hover:bg-destructive/20"
              title="Remove"
            >
              <TrashIcon className="w-3 h-3 text-muted-foreground hover:text-destructive" />
            </button>
          </div>
        )}
      </div>

      {/* Promote inline form */}
      {isPromoting && (
        <div className="mt-1.5 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <input
            type="text"
            value={promoteBranch}
            onChange={(e) => setPromoteBranch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && promoteBranch.trim()) onPromote(promoteBranch.trim());
              if (e.key === 'Escape') onPromoteToggle();
            }}
            className="flex-1 h-6 px-2 text-xs bg-muted/30 border border-border/50 rounded outline-none focus:ring-1 focus:ring-ring"
            placeholder="Branch name"
            autoFocus
          />
          <button
            onClick={() => promoteBranch.trim() && onPromote(promoteBranch.trim())}
            className="h-6 px-2 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
            disabled={!promoteBranch.trim()}
          >
            Promote
          </button>
        </div>
      )}

      {/* Setup progress area */}
      {setupLines && setupLines.length > 0 && (
        <div className="mt-1">
          <button
            onClick={(e) => { e.stopPropagation(); setShowSetup(!showSetup); }}
            className="text-[10px] text-muted-foreground/70 hover:text-muted-foreground"
          >
            {showSetup ? 'Hide setup output' : `Setup (${setupLines.length} lines)`}
          </button>
          {showSetup && (
            <VirtualTextLines
              lines={setupLines}
              estimateSize={() => 16}
              className="mt-1 max-h-24 rounded bg-black/20 p-1.5 font-mono text-[10px] leading-tight text-muted-foreground"
              lineClassName="whitespace-pre-wrap break-all"
              testId="worktree-setup-output"
            />
          )}
        </div>
      )}
    </div>
  );
};
