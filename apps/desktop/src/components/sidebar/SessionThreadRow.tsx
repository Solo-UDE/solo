/**
 * SessionThreadRow — single session entry rendered inside a worktree group.
 *
 * Compact row with streaming indicator, title, and last-active timestamp.
 * Matches the app's denser sidebar styling — smaller padding, 12px text,
 * context menu for rename/delete.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { FC, KeyboardEvent } from 'react';
import { Pencil2Icon, TrashIcon } from '@radix-ui/react-icons';
import { GitBranch, MessageCircle } from 'lucide-react';
import type { AgentSession, Message } from '@/stores/agentStore';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { isGitAgentSession } from '@/lib/git-agent';
import { cn } from '@/lib/utils';

export interface SessionThreadRowProps {
  readonly session: AgentSession;
  readonly title: string;
  readonly isActive: boolean;
  readonly isStreaming: boolean;
  readonly hasOpenTab: boolean;
  readonly isRenaming: boolean;
  readonly renameValue: string;
  readonly messagesMap: Map<string, Message[]>;
  readonly onSelect: () => void;
  readonly onStartRename: () => void;
  readonly onCommitRename: () => void;
  readonly onCancelRename: () => void;
  readonly onRenameChange: (value: string) => void;
  readonly onRequestDelete: () => void;
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const SessionThreadRow: FC<SessionThreadRowProps> = ({
  session,
  title,
  isActive,
  isStreaming,
  hasOpenTab,
  isRenaming,
  renameValue,
  onSelect,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onRenameChange,
  onRequestDelete,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onCommitRename();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancelRename();
      }
    },
    [onCommitRename, onCancelRename],
  );

  const isGitAgent = isGitAgentSession(session);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={isRenaming}>
        <button
          type="button"
          onClick={() => {
            if (!isRenaming) onSelect();
          }}
          onDoubleClick={onStartRename}
          className={cn(
            'group relative w-full flex items-center gap-2 rounded-[8px] pl-6 pr-2 py-1.5 text-left transition-[background-color,color] duration-150',
            isActive
              ? 'bg-background/80 text-foreground'
              : 'text-muted-foreground hover:bg-background/55 hover:text-foreground',
            isGitAgent && 'ring-1 ring-primary/15',
          )}
        >
          {isStreaming ? (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary animate-pulse"
              aria-hidden="true"
            />
          ) : isGitAgent ? (
            <GitBranch
              className={cn(
                'h-3 w-3 shrink-0',
                hasOpenTab ? 'text-primary' : 'text-primary/60',
              )}
            />
          ) : (
            <MessageCircle
              className={cn(
                'h-3 w-3 shrink-0',
                hasOpenTab ? 'text-primary' : 'text-muted-foreground/60',
              )}
            />
          )}

          <div className="min-w-0 flex-1">
            {isRenaming ? (
              <input
                ref={inputRef}
                type="text"
                value={renameValue}
                onChange={(e) => onRenameChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={onCommitRename}
                onClick={(e) => e.stopPropagation()}
                className="w-full bg-transparent text-[12px] outline-none border-b border-primary text-foreground placeholder:text-muted-foreground/60"
                placeholder="Session name"
              />
            ) : (
              <span className="block truncate text-[12px] leading-snug">
                {title || 'New Session'}
              </span>
            )}
          </div>

          {!isRenaming && (
            <span className="shrink-0 text-[10px] text-muted-foreground/60 group-hover:text-muted-foreground/80">
              {formatRelative(session.createdAt)}
            </span>
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem onClick={onStartRename}>
          <Pencil2Icon width={14} height={14} />
          <span>Rename</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={onRequestDelete}
          className="text-destructive focus:text-destructive"
        >
          <TrashIcon width={14} height={14} />
          <span>Delete</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};
