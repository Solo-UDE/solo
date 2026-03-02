/**
 * WorktreeDetailView - Drill-in view for a selected worktree.
 * Shows back header, then collapsible Explorer/Sessions/Changes sections.
 */

import { useCallback } from 'react';
import type { FC } from 'react';
import { CaretLeft, Files, ChatTeardrop, GitBranch, Plus } from '@phosphor-icons/react';
import { FileExplorer } from '@/components/file-explorer';
import { SessionList } from '@/components/agent';
import { CollapsibleSection } from './CollapsibleSection';
import { SimplifiedChangesView } from './SimplifiedChangesView';
import { useUIStore } from '@/stores/uiStore';
import { useWorktreeStore } from '@/stores/worktreeStore';
import { useSidebarActions } from '@/hooks/useSidebarActions';
import { cn } from '@/lib/utils';

interface WorktreeDetailViewProps {
  readonly onFileOpen: (path: string) => void;
}

export const WorktreeDetailView: FC<WorktreeDetailViewProps> = ({ onFileOpen }) => {
  const devDetailWorktreeId = useUIStore((s) => s.devDetailWorktreeId);
  const drillOut = useUIStore((s) => s.drillOutOfWorktree);
  const worktrees = useWorktreeStore((s) => s.worktrees);
  const { handleSessionSelect, handleNewSession } = useSidebarActions();

  const worktree = devDetailWorktreeId ? worktrees.get(devDetailWorktreeId) : null;
  const branchLabel = worktree
    ? (worktree.is_main ? 'main' : (worktree.branch ?? worktree.id))
    : 'Worktree';

  const handleBack = useCallback(() => {
    drillOut();
  }, [drillOut]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Back header */}
      <button
        onClick={handleBack}
        className={cn(
          'flex items-center gap-1.5 h-8 px-2.5 w-full shrink-0',
          'text-xs font-medium text-muted-foreground',
          'hover:text-foreground hover:bg-muted/30',
          'transition-colors duration-150',
        )}
      >
        <CaretLeft className="w-3.5 h-3.5 shrink-0" weight="bold" />
        <span className="truncate text-[13px] font-semibold">{branchLabel}</span>
      </button>

      {/* Collapsible sections */}
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        <CollapsibleSection title="Explorer" icon={Files} defaultOpen={true}>
          <FileExplorer onFileOpen={onFileOpen} className="h-full" />
        </CollapsibleSection>

        <CollapsibleSection
          title="Sessions"
          icon={ChatTeardrop}
          defaultOpen={true}
          actions={
            <button
              onClick={(e) => { e.stopPropagation(); handleNewSession(); }}
              className={cn(
                'w-5 h-5 flex items-center justify-center rounded',
                'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                'active:scale-95 transition-all duration-200',
              )}
              title="New Session"
            >
              <Plus className="w-3 h-3" weight="bold" />
            </button>
          }
        >
          <SessionList
            onSessionSelect={handleSessionSelect}
            onNewSession={handleNewSession}
            className="h-full"
          />
        </CollapsibleSection>

        <CollapsibleSection title="Changes" icon={GitBranch} defaultOpen={true}>
          <SimplifiedChangesView />
        </CollapsibleSection>
      </div>
    </div>
  );
};
