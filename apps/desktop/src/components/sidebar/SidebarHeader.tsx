/**
 * SidebarHeader — workspace identity row for the active repo. Flat: just the
 * icon + name, no bordered card, no nested boxes. Space and weight carry the
 * hierarchy.
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
    <div className="flex items-center gap-2.5 px-1 py-1">
      {Icon ? (
        <Icon
          className="h-4 w-4 shrink-0"
          style={{ color: getRepoColorVar(activeRepo.color) }}
        />
      ) : null}
      <div className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-tight text-foreground">
        {activeRepo.name}
      </div>
    </div>
  );
};
