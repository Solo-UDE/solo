/**
 * WorktreeBackButton — Compact breadcrumb to return from worktree detail view to repo list
 */

import { useCallback, type FC } from 'react';
import { CaretLeft, Folder } from '@phosphor-icons/react';
import { useUIStore } from '@/stores/uiStore';
import { useActiveRepo } from '@/stores/repoStore';

export const WorktreeBackButton: FC = () => {
  const setSidebarView = useUIStore((s) => s.setSidebarView);
  const activeRepo = useActiveRepo();

  const handleBack = useCallback(() => {
    setSidebarView('repos');
  }, [setSidebarView]);

  return (
    <button
      onClick={handleBack}
      className="flex items-center gap-1.5 h-8 px-2 w-full shrink-0 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-[background-color,color] duration-150"
      title="Back to repositories"
    >
      <CaretLeft className="w-3 h-3 shrink-0" weight="bold" />
      <Folder className="w-3.5 h-3.5 shrink-0" weight="fill" />
      <span className="truncate font-medium">{activeRepo?.name ?? 'Repositories'}</span>
    </button>
  );
};
