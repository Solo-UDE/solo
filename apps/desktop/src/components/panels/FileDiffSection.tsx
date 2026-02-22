/**
 * FileDiffSection — collapsible per-file diff with Codex-style unified lines
 */

import { useState, useCallback, memo } from 'react';
import { CaretDown, CaretRight } from '@phosphor-icons/react';
import type { FileDiff, DiffHunk } from '@/lib/tauri/git';
import { cn } from '@/lib/utils';

interface FileDiffSectionProps {
  readonly file: FileDiff;
  readonly defaultOpen?: boolean;
}

const statusBadgeClass: Record<string, string> = {
  added: 'bg-emerald-400/10 text-emerald-400',
  modified: 'bg-blue-400/10 text-blue-400',
  deleted: 'bg-red-400/10 text-red-400',
  renamed: 'bg-amber-400/10 text-amber-400',
};

/** Render a gap between hunks showing unmodified line count */
const UnmodifiedGap = memo(({ count }: { count: number }) => {
  if (count <= 0) return null;
  return (
    <div className="flex items-center justify-center h-6 text-[10px] text-muted-foreground/40 bg-muted/20 select-none">
      {count} unmodified line{count !== 1 ? 's' : ''}
    </div>
  );
});
UnmodifiedGap.displayName = 'UnmodifiedGap';

/** Render a single diff line */
const DiffLineRow = memo(
  ({
    kind,
    content,
    oldLineNo,
    newLineNo,
  }: {
    kind: string;
    content: string;
    oldLineNo: number | null;
    newLineNo: number | null;
  }) => {
    const isAdd = kind === 'add';
    const isDel = kind === 'delete';

    return (
      <div
        className={cn(
          'flex font-mono text-xs leading-5 min-h-[20px]',
          isAdd && 'bg-emerald-950/40 text-emerald-300',
          isDel && 'bg-red-950/40 text-red-300',
          !isAdd && !isDel && 'text-muted-foreground',
        )}
      >
        <span className="w-[42px] shrink-0 text-right pr-1.5 text-muted-foreground/30 select-none tabular-nums">
          {oldLineNo ?? ''}
        </span>
        <span className="w-[42px] shrink-0 text-right pr-1.5 text-muted-foreground/30 select-none tabular-nums">
          {newLineNo ?? ''}
        </span>
        <span className="w-4 shrink-0 text-center select-none opacity-50">
          {isAdd ? '+' : isDel ? '-' : ' '}
        </span>
        <span className="flex-1 whitespace-pre overflow-x-auto pr-2">{content}</span>
      </div>
    );
  },
);
DiffLineRow.displayName = 'DiffLineRow';

/** Render all hunks for a file */
const HunkList = memo(({ hunks }: { hunks: DiffHunk[] }) => (
  <div className="border-t border-border/5">
    {hunks.map((hunk, hunkIdx) => {
      // Compute gap between previous hunk's last line and this hunk
      const prevHunk = hunkIdx > 0 ? hunks[hunkIdx - 1] : null;
      let gapLines = 0;
      if (prevHunk) {
        const prevEnd = prevHunk.new_start + prevHunk.new_lines;
        gapLines = hunk.new_start - prevEnd;
      } else if (hunk.new_start > 1) {
        gapLines = hunk.new_start - 1;
      }

      return (
        <div key={hunkIdx}>
          <UnmodifiedGap count={gapLines} />
          {hunk.lines.map((line, lineIdx) => (
            <DiffLineRow
              key={lineIdx}
              kind={line.kind}
              content={line.content}
              oldLineNo={line.old_line_no}
              newLineNo={line.new_line_no}
            />
          ))}
        </div>
      );
    })}
  </div>
));
HunkList.displayName = 'HunkList';

export const FileDiffSection = memo(({ file, defaultOpen = true }: FileDiffSectionProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  const fileName = file.path.split('/').pop() ?? file.path;
  const dirPath = file.path.includes('/')
    ? file.path.slice(0, file.path.lastIndexOf('/'))
    : '';

  return (
    <div className="rounded-lg overflow-hidden bg-card/50 shadow-sm">
      {/* File header */}
      <button
        onClick={toggle}
        className={cn(
          'flex items-center gap-2 w-full px-3 h-9 text-left',
          'bg-muted/30 hover:bg-muted/50 transition-colors duration-150',
          'text-xs font-medium',
        )}
      >
        {isOpen ? (
          <CaretDown className="w-3 h-3 shrink-0 text-muted-foreground" weight="bold" />
        ) : (
          <CaretRight className="w-3 h-3 shrink-0 text-muted-foreground" weight="bold" />
        )}
        <span className="truncate text-foreground">{fileName}</span>
        {dirPath && (
          <span className="truncate text-muted-foreground/50 text-[10px]">{dirPath}</span>
        )}
        <span className="ml-auto flex items-center gap-2 shrink-0">
          <span className="flex items-center gap-1 text-[10px]">
            {file.additions > 0 && (
              <span className="text-emerald-400">+{file.additions}</span>
            )}
            {file.deletions > 0 && (
              <span className="text-red-400">-{file.deletions}</span>
            )}
          </span>
          <span
            className={cn(
              'px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase',
              statusBadgeClass[file.status] ?? 'bg-muted/50 text-muted-foreground',
            )}
          >
            {file.status}
          </span>
        </span>
      </button>

      {/* Diff body */}
      {isOpen && file.hunks.length > 0 && <HunkList hunks={file.hunks} />}
    </div>
  );
});
FileDiffSection.displayName = 'FileDiffSection';
