/**
 * SidebarHeader - Compact workspace identity card for the active repo.
 */

import { useMemo, type FC } from 'react';
import { useActiveRepo } from '@/stores/repoStore';
import { getRepoIcon, getRepoColorVar } from '@/lib/repoIdentity';

export const SidebarHeader: FC = () => {
  const activeRepo = useActiveRepo();

  const Icon = useMemo(
    () => (activeRepo ? getRepoIcon(activeRepo.icon) : null),
    [activeRepo],
  );

  if (!activeRepo) return null;

  return (
    <div className="rounded-[10px] border border-border/70 bg-background/60 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-border/70 bg-card/80">
          {Icon ? (
            <Icon
              className="h-4 w-4 shrink-0"
              style={{ color: getRepoColorVar(activeRepo.color) }}
            />
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold tracking-tight text-foreground">
            {activeRepo.name}
          </div>
        </div>
      </div>
    </div>
  );
};
