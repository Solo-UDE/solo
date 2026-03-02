/**
 * SimplifiedChangesView - Stripped-down source control for worktree drill-in.
 * Shows changed files with a review button. No staging, commit, or push UI.
 */

import { useCallback } from 'react';
import type { FC } from 'react';
import { Eye } from '@phosphor-icons/react';
import { FileChangeItem } from '@/components/source-control/FileChangeItem';
import { useGitStore } from '@/stores/gitStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import { BUILTIN_PANEL_TYPES } from '@/lib/panels';
import { cn } from '@/lib/utils';

interface SimplifiedChangesViewProps {
  readonly className?: string;
}

export const SimplifiedChangesView: FC<SimplifiedChangesViewProps> = ({ className }) => {
  const changedFiles = useGitStore((s) => s.changedFiles);
  const discardFile = useGitStore((s) => s.discardFile);
  const currentBranch = useGitStore((s) => s.currentBranch);

  const handleViewDiff = useCallback((filePath: string) => {
    const fileName = filePath.split('/').pop() ?? filePath;
    usePanelTabsStore.getState().openPanel(BUILTIN_PANEL_TYPES.GIT_DIFF, {
      filePath,
      fileName,
    });
  }, []);

  const handleDiscard = useCallback((filePath: string) => {
    discardFile(filePath);
  }, [discardFile]);

  const handleReview = useCallback(() => {
    usePanelTabsStore.getState().openPanel(BUILTIN_PANEL_TYPES.BRANCH_DIFF, {
      branch: currentBranch,
    });
  }, [currentBranch]);

  if (changedFiles.length === 0) {
    return (
      <div className={cn('py-4 text-center', className)}>
        <p className="text-xs text-muted-foreground/60">No changes</p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Header row */}
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[10px] text-muted-foreground/60">
          {changedFiles.length} file{changedFiles.length !== 1 ? 's' : ''} changed
        </span>
        <button
          onClick={handleReview}
          className={cn(
            'h-5 w-5 flex items-center justify-center rounded',
            'text-muted-foreground hover:text-foreground hover:bg-muted/60',
            'active:scale-95 transition-all duration-150',
          )}
          title="Review changes"
        >
          <Eye className="w-3 h-3" weight="bold" />
        </button>
      </div>

      {/* File list — no staging props = no stage/unstage buttons */}
      <div className="overflow-y-auto">
        {changedFiles.map((file) => (
          <FileChangeItem
            key={file.path}
            file={file}
            onDiscard={handleDiscard}
            onViewDiff={handleViewDiff}
          />
        ))}
      </div>
    </div>
  );
};
