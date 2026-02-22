/**
 * WorktreeDiffPanel — shows files changed in a worktree relative to its base commit
 */

import { useState, useEffect, useCallback } from 'react';
import { CircleNotch, WarningCircle, File, FilePlus, FileMinus, FileArrowUp } from '@phosphor-icons/react';
import { diffFromBase } from '@/lib/tauri/worktree';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import { BUILTIN_PANEL_TYPES } from '@/lib/panels';
import { cn } from '@/lib/utils';
import type { PanelProps } from '@/lib/panels/types';
import type { WorktreeDiffEntry } from '@/bindings';

interface WorktreeDiffData {
  worktreeId: string;
  branch: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof File }> = {
  added: { label: 'A', color: 'text-emerald-400 bg-emerald-400/10', icon: FilePlus },
  modified: { label: 'M', color: 'text-amber-400 bg-amber-400/10', icon: File },
  deleted: { label: 'D', color: 'text-red-400 bg-red-400/10', icon: FileMinus },
  renamed: { label: 'R', color: 'text-blue-400 bg-blue-400/10', icon: FileArrowUp },
};

export const WorktreeDiffPanel = ({
  data,
  onTitleChange,
}: PanelProps<WorktreeDiffData>) => {
  const [entries, setEntries] = useState<WorktreeDiffEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const worktreeId = data.worktreeId as string;
  const branch = data.branch as string;

  useEffect(() => {
    onTitleChange(`Diff: ${branch}`);
  }, [branch, onTitleChange]);

  useEffect(() => {
    if (!worktreeId) return;

    setIsLoading(true);
    setError(null);

    diffFromBase(worktreeId)
      .then((result) => {
        setEntries(result);
        setIsLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setIsLoading(false);
      });
  }, [worktreeId]);

  const handleViewDiff = useCallback(
    (filePath: string) => {
      const fileName = filePath.split('/').pop() ?? filePath;
      usePanelTabsStore.getState().openPanel(BUILTIN_PANEL_TYPES.GIT_DIFF, { filePath, fileName });
    },
    [],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <CircleNotch className="w-5 h-5 text-muted-foreground animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 px-6">
        <WarningCircle className="w-6 h-6 text-destructive" />
        <p className="text-xs text-muted-foreground text-center">{error}</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 px-6">
        <File className="w-8 h-8 text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground/60">No changes from base branch</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="py-1">
        {entries.map((entry) => {
          const config = STATUS_CONFIG[entry.status] ?? STATUS_CONFIG.modified;
          const Icon = config.icon;
          const fileName = entry.path.split('/').pop() ?? entry.path;
          const dirPath = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';

          return (
            <button
              key={entry.path}
              onClick={() => handleViewDiff(entry.path)}
              className={cn(
                'group w-full flex items-center gap-2 px-3 py-1.5 text-left',
                'hover:bg-muted/40 transition-colors duration-150',
              )}
            >
              <Icon className={cn('w-3.5 h-3.5 shrink-0', config.color.split(' ')[0])} />
              <span className="text-xs text-foreground truncate">{fileName}</span>
              {dirPath && (
                <span className="text-2xs text-muted-foreground/60 truncate">{dirPath}</span>
              )}
              <span className="ml-auto flex items-center gap-1.5 text-2xs shrink-0">
                {entry.additions > 0 && (
                  <span className="text-emerald-400">+{entry.additions}</span>
                )}
                {entry.deletions > 0 && (
                  <span className="text-red-400">-{entry.deletions}</span>
                )}
                <span className={cn('px-1 py-0.5 rounded text-2xs font-semibold', config.color)}>
                  {config.label}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
