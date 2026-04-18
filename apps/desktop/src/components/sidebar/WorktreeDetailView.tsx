/**
 * WorktreeDetailView — Drill-in view for a selected worktree.
 * Icon tab bar switches between Explorer / Sessions / Changes sections.
 */

import { useState, useCallback, useRef } from 'react';
import type { FC } from 'react';
import { ChevronDownIcon, ChevronLeftIcon, PlusIcon } from '@radix-ui/react-icons';
import { Files, MessageCircle, GitBranch } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { FileExplorer } from '@/components/file-explorer';
import { SessionList } from '@/components/agent';
import { WorktreeChangesView } from './WorktreeChangesView';
import { BranchPicker } from './BranchPicker';
import { useUIStore } from '@/stores/uiStore';
import { useWorktreeStore } from '@/stores/worktreeStore';
import { useGitStore } from '@/stores/gitStore';
import { useSidebarActions } from '@/hooks/useSidebarActions';
import { openGitAgentForDirtySwitch } from '@/lib/git-agent/trigger';
import { cn } from '@/lib/utils';

type WorktreeDetailSection = 'explorer' | 'sessions' | 'changes';

const SECTIONS: { key: WorktreeDetailSection; icon: typeof Files; label: string }[] = [
  { key: 'explorer', icon: Files, label: 'Explorer' },
  { key: 'sessions', icon: MessageCircle, label: 'Sessions' },
  { key: 'changes', icon: GitBranch, label: 'Changes' },
];

interface WorktreeDetailViewProps {
  readonly onFileOpen: (path: string) => void;
}

export const WorktreeDetailView: FC<WorktreeDetailViewProps> = ({ onFileOpen }) => {
  const [activeSection, setActiveSection] = useState<WorktreeDetailSection>('explorer');
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const scrollPositions = useRef<Map<string, number>>(new Map());
  const contentRef = useRef<HTMLDivElement>(null);
  const branchTriggerRef = useRef<HTMLButtonElement>(null);

  const devDetailWorktreeId = useUIStore((s) => s.devDetailWorktreeId);
  const drillOut = useUIStore((s) => s.drillOutOfWorktree);
  const worktrees = useWorktreeStore((s) => s.worktrees);
  const changedFiles = useGitStore((s) => s.changedFiles);
  const commitsAhead = useGitStore((s) => s.commitsAhead);
  const { handleSessionSelect, handleNewSession } = useSidebarActions();

  const worktree = devDetailWorktreeId ? worktrees.get(devDetailWorktreeId) : null;
  const branchLabel = worktree
    ? (worktree.is_main ? 'main' : (worktree.branch ?? worktree.id))
    : 'Worktree';
  const isDirty = changedFiles.length > 0;

  const handleBack = useCallback(() => {
    drillOut();
  }, [drillOut]);

  const handleDirtySwitch = useCallback(
    (targetBranch: string) => {
      if (!worktree) return;
      openGitAgentForDirtySwitch({
        worktreeId: worktree.id,
        fromBranch: branchLabel,
        toBranch: targetBranch,
        changedFileCount: changedFiles.length,
      });
    },
    [worktree, branchLabel, changedFiles.length],
  );

  const handleSectionChange = useCallback((key: WorktreeDetailSection) => {
    if (key === activeSection) return; // No-op on active tab
    // Save current scroll position
    if (contentRef.current) {
      scrollPositions.current.set(activeSection, contentRef.current.scrollTop);
    }
    setActiveSection(key);
    // Restore target scroll position after render
    requestAnimationFrame(() => {
      if (contentRef.current) {
        contentRef.current.scrollTop = scrollPositions.current.get(key) ?? 0;
      }
    });
  }, [activeSection]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Back header with branch picker + ahead indicator */}
      <div className="relative flex items-center gap-0.5 px-1.5 h-8 shrink-0">
        <button
          onClick={handleBack}
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px]',
            'text-muted-foreground hover:text-foreground hover:bg-muted/30',
            'transition-colors duration-150',
          )}
          title="Back"
        >
          <ChevronLeftIcon className="w-3.5 h-3.5" />
        </button>
        <button
          ref={branchTriggerRef}
          onClick={() => setBranchPickerOpen((v) => !v)}
          className={cn(
            'flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-[7px] px-2',
            'text-[13px] font-medium text-foreground',
            'hover:bg-muted/30 active:scale-[0.98]',
            'transition-[transform,background-color] duration-150',
          )}
          title="Switch branch"
        >
          <GitBranch className="h-3 w-3 shrink-0 text-primary" />
          <span className="truncate">{branchLabel}</span>
          {isDirty && (
            <span
              title="Uncommitted changes"
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
              aria-label="Uncommitted changes"
            />
          )}
          {commitsAhead != null && commitsAhead > 0 && (
            <span className="shrink-0 text-[10px] text-primary/70">
              &uarr;{commitsAhead}
            </span>
          )}
          <ChevronDownIcon className="h-3 w-3 shrink-0 text-muted-foreground/60" />
        </button>
        {branchPickerOpen && (
          <BranchPicker
            triggerRef={branchTriggerRef}
            isDirty={isDirty}
            onDirtySwitch={handleDirtySwitch}
            onClose={() => setBranchPickerOpen(false)}
          />
        )}
      </div>

      {/* Icon tab bar */}
      <div className="flex items-center px-2 shrink-0 border-b border-white/[0.04]">
        <div className="relative flex items-center gap-0.5" role="tablist" aria-label="Worktree sections">
          {SECTIONS.map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              role="tab"
              aria-selected={activeSection === key}
              aria-label={label}
              onClick={() => handleSectionChange(key)}
              className={cn(
                'relative w-8 h-8 flex items-center justify-center rounded-lg',
                'transition-[transform,background-color,color] duration-200',
                'active:scale-95',
                activeSection === key
                  ? 'text-foreground'
                  : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/60',
              )}
              title={label}
            >
              <Icon
                className="w-[16px] h-[16px]"
                aria-hidden="true"
              />
              {/* Change count badge on GitBranch icon */}
              {key === 'changes' && changedFiles.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full text-[9px] font-bold bg-primary/15 text-primary flex items-center justify-center">
                  {changedFiles.length}
                </span>
              )}
              {/* Animated underline indicator */}
              {activeSection === key && (
                <motion.div
                  className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-[2px] rounded-full bg-primary"
                  layoutId="worktree-detail-tab-indicator"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
            </button>
          ))}
        </div>

        {/* New Session button (shown when sessions tab is active) */}
        {activeSection === 'sessions' && (
          <button
            onClick={handleNewSession}
            className={cn(
              'ml-auto w-6 h-6 flex items-center justify-center rounded-md',
              'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              'active:scale-95 transition-all duration-200',
            )}
            title="New Session"
          >
            <PlusIcon className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Content area with scroll preservation */}
      <div ref={contentRef} className="flex-1 min-h-0 overflow-y-auto">
        <AnimatePresence mode="wait">
          {activeSection === 'explorer' && (
            <motion.div
              key="explorer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
              className="h-full"
            >
              <FileExplorer onFileOpen={onFileOpen} className="h-full" />
            </motion.div>
          )}
          {activeSection === 'sessions' && (
            <motion.div
              key="sessions"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
              className="h-full"
            >
              <SessionList
                onSessionSelect={handleSessionSelect}
                onNewSession={handleNewSession}
                className="h-full"
              />
            </motion.div>
          )}
          {activeSection === 'changes' && (
            <motion.div
              key="changes"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
              className="h-full"
            >
              <WorktreeChangesView />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
