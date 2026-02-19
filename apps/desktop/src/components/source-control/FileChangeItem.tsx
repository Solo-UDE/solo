/**
 * FileChangeItem — single row in the changed files list
 */

import { useState, useCallback } from 'react';
import type { FC } from 'react';
import { ArrowCounterClockwise, Plus, Minus } from '@phosphor-icons/react';
import type { GitChangedFile } from '@/bindings/GitChangedFile';
import type { GitFileStatus } from '@/bindings/GitFileStatus';
import { cn } from '@/lib/utils';

interface FileChangeItemProps {
  readonly file: GitChangedFile;
  readonly onDiscard: (filePath: string) => void;
  readonly onViewDiff: (filePath: string) => void;
  readonly onStage?: (filePath: string) => void;
  readonly onUnstage?: (filePath: string) => void;
}

const STATUS_LABELS: Record<GitFileStatus, string> = {
  modified: 'M',
  added: 'U',
  deleted: 'D',
  renamed: 'R',
};

const STATUS_COLORS: Record<GitFileStatus, string> = {
  modified: 'text-amber-400',
  added: 'text-emerald-400',
  deleted: 'text-red-400',
  renamed: 'text-blue-400',
};

const STATUS_BG: Record<GitFileStatus, string> = {
  modified: 'bg-amber-400/10',
  added: 'bg-emerald-400/10',
  deleted: 'bg-red-400/10',
  renamed: 'bg-blue-400/10',
};

export const FileChangeItem: FC<FileChangeItemProps> = ({ file, onDiscard, onViewDiff, onStage, onUnstage }) => {
  const [isHovered, setIsHovered] = useState(false);

  const fileName = file.path.split('/').pop() ?? file.path;
  const dirPath = file.path.includes('/')
    ? file.path.substring(0, file.path.lastIndexOf('/'))
    : '';

  const handleClick = useCallback(() => {
    onViewDiff(file.path);
  }, [file.path, onViewDiff]);

  const handleDiscard = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDiscard(file.path);
    },
    [file.path, onDiscard],
  );

  const handleStageToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (file.is_staged) {
        onUnstage?.(file.path);
      } else {
        onStage?.(file.path);
      }
    },
    [file.path, file.is_staged, onStage, onUnstage],
  );

  return (
    <div
      className={cn(
        'group flex items-center gap-1.5 h-7 px-2.5 rounded-lg cursor-pointer',
        'hover:bg-muted/50 transition-colors duration-150',
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
    >
      {/* Status badge */}
      <span
        className={cn(
          'shrink-0 w-4 h-4 flex items-center justify-center rounded text-[10px] font-bold',
          STATUS_COLORS[file.status],
          STATUS_BG[file.status],
        )}
      >
        {STATUS_LABELS[file.status]}
      </span>

      {/* File name */}
      <span className="text-xs text-foreground truncate flex-1">{fileName}</span>

      {/* Directory path */}
      {dirPath && (
        <span className="text-[10px] text-muted-foreground/50 truncate max-w-[80px] shrink-0">
          {dirPath}
        </span>
      )}

      {/* Insertions / Deletions */}
      {(file.insertions > 0 || file.deletions > 0) && !isHovered && (
        <span className="flex items-center gap-0.5 text-[10px] shrink-0">
          {file.insertions > 0 && (
            <span className="text-emerald-400">+{file.insertions}</span>
          )}
          {file.deletions > 0 && (
            <span className="text-red-400">-{file.deletions}</span>
          )}
        </span>
      )}

      {/* Action buttons (on hover) */}
      {isHovered && (
        <span className="flex items-center gap-0.5 shrink-0">
          {/* Stage / Unstage button */}
          <button
            onClick={handleStageToggle}
            className={cn(
              'shrink-0 w-5 h-5 flex items-center justify-center rounded-md',
              'text-muted-foreground hover:text-foreground hover:bg-muted/60',
              'active:scale-[0.9] transition-[transform,background-color] duration-150',
            )}
            title={file.is_staged ? 'Unstage' : 'Stage'}
          >
            {file.is_staged ? (
              <Minus className="w-3 h-3" weight="bold" />
            ) : (
              <Plus className="w-3 h-3" weight="bold" />
            )}
          </button>

          {/* Discard button (only for unstaged files) */}
          {!file.is_staged && (
            <button
              onClick={handleDiscard}
              className={cn(
                'shrink-0 w-5 h-5 flex items-center justify-center rounded-md',
                'text-muted-foreground hover:text-destructive hover:bg-destructive/10',
                'active:scale-[0.9] transition-[transform,background-color] duration-150',
              )}
              title="Discard changes"
            >
              <ArrowCounterClockwise className="w-3 h-3" weight="bold" />
            </button>
          )}
        </span>
      )}
    </div>
  );
};
