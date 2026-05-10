/**
 * SessionList - ChatGPT-style session list for sidebar
 * Shows all sessions with titles from first message, context menu, search, and sorting
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { PlusIcon, Pencil2Icon, TrashIcon, MagnifyingGlassIcon } from '@radix-ui/react-icons';
import { MessageCircle } from 'lucide-react';
import { useAgentStore, useSessions, useActiveSessionId } from '@/stores/agentStore';
import type { Message } from '@/stores/agentStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import { useWorktreeStore } from '@/stores/worktreeStore';
import { useFileExplorerStore } from '@/stores/fileExplorerStore';
import { BUILTIN_PANEL_TYPES } from '@/lib/panels/constants';
import { useInlineRename } from '@/hooks/useInlineRename';
import { cn } from '@/lib/utils';
import { VirtualList } from '@/components/ui/virtual-list';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

import type { FC } from 'react';
import type { AgentSession } from '@/stores/agentStore';

export interface SessionListProps {
  /** Called when a session is selected */
  readonly onSessionSelect: (sessionId: string) => void;
  /** Called when new session button is clicked */
  readonly onNewSession: () => void;
  /** Additional CSS class */
  readonly className?: string;
}

const EMPTY_SET = new Set<string>();

/**
 * Compute the set of session IDs that currently have open tabs.
 * Uses useRef to return a stable reference for React 19 compatibility.
 */
function useOpenSessionIds(): Set<string> {
  const prevRef = useRef<{ key: string; result: Set<string> }>({ key: '', result: EMPTY_SET });

  return usePanelTabsStore((state) => {
    // Build a sorted key of open agent session IDs
    const ids: string[] = [];
    for (const instance of state.instances.values()) {
      if (instance.panelType === BUILTIN_PANEL_TYPES.AGENT) {
        const sid = (instance.data as Record<string, unknown>)?.sessionId;
        if (typeof sid === 'string') {
          ids.push(sid);
        }
      }
    }
    ids.sort();
    const key = ids.join(',');

    if (key === prevRef.current.key) {
      return prevRef.current.result;
    }

    const result = new Set(ids);
    prevRef.current = { key, result };
    return result;
  });
}

/**
 * Compute the set of session IDs that are currently streaming.
 * Uses useRef to return a stable reference for React 19 compatibility.
 */
function useStreamingSessionIds(): Set<string> {
  const prevRef = useRef<{ key: string; result: Set<string> }>({ key: '', result: EMPTY_SET });

  return useAgentStore((state) => {
    const ids: string[] = [];
    for (const [sessionId, streamState] of state.sessionStreaming.entries()) {
      if (streamState.isStreaming) {
        ids.push(sessionId);
      }
    }
    ids.sort();
    const key = ids.join(',');

    if (key === prevRef.current.key) {
      return prevRef.current.result;
    }

    const result = new Set(ids);
    prevRef.current = { key, result };
    return result;
  });
}

/**
 * Derive a display title for a session.
 * Priority: custom name > first user message (truncated) > "New Session"
 * Takes messages as parameter so the caller subscribes to store changes reactively.
 */
function getSessionTitle(sessionId: string, name: string | undefined, messagesMap: Map<string, Message[]>): string {
  if (name) return name;
  const messages = messagesMap.get(sessionId);
  const firstUserMsg = messages?.find((m) => m.role === 'user');
  if (!firstUserMsg) return 'New Session';
  const content = firstUserMsg.content;
  return content.length <= 40 ? content : content.slice(0, 40) + '...';
}

/**
 * Format session date for display
 */
function formatSessionDate(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Individual session item with context menu
 */
const SessionItem: FC<{
  session: AgentSession;
  isActive: boolean;
  isStreaming: boolean;
  hasOpenTab: boolean;
  isRenaming: boolean;
  renameValue: string;
  messagesMap: Map<string, Message[]>;
  onSelect: () => void;
  onStartRename: () => void;
  onDoubleClickRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onRenameChange: (value: string) => void;
  onRequestDelete: () => void;
}> = ({
  session,
  isActive,
  isStreaming,
  hasOpenTab,
  isRenaming,
  renameValue,
  messagesMap,
  onSelect,
  onStartRename,
  onDoubleClickRename,
  onCommitRename,
  onCancelRename,
  onRenameChange,
  onRequestDelete,
}) => {
  const renameInputRef = useRef<HTMLInputElement>(null);
  const title = getSessionTitle(session.id, session.name, messagesMap);

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onCommitRename();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancelRename();
      }
    },
    [onCommitRename, onCancelRename]
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={isRenaming}>
        <div className="relative">
          <button
            onClick={() => {
              if (!isRenaming) onSelect();
            }}
            onDoubleClick={onDoubleClickRename}
            className={cn(
              'w-full px-2.5 py-1.5 flex items-center gap-2 rounded-md text-left transition-[background-color,color] duration-150',
              'hover:bg-muted/60 hover:scale-[1.02] active:scale-[0.97]',
              isActive
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {isStreaming && (
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />
            )}

            <MessageCircle
              className={cn(
                'h-3.5 w-3.5 shrink-0',
                hasOpenTab ? 'text-primary' : ''
              )}
            />

            <div className="flex-1 min-w-0">
              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  type="text"
                  value={renameValue}
                  onChange={(e) => onRenameChange(e.target.value)}
                  onKeyDown={handleRenameKeyDown}
                  onBlur={onCommitRename}
                  className="w-full text-sm bg-transparent border-b border-primary outline-none text-foreground placeholder:text-muted-foreground/60"
                  placeholder="Session name..."
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  <span className="text-[12px] leading-tight truncate block">{title}</span>
                  <span className="text-[10.5px] leading-tight text-muted-foreground/60 truncate block">
                    {formatSessionDate(session.createdAt)}
                  </span>
                </>
              )}
            </div>
          </button>
        </div>
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

/**
 * Session list component for sidebar
 */
export const SessionList: FC<SessionListProps> = ({
  onSessionSelect,
  onNewSession,
  className = '',
}) => {
  const sessions = useSessions();
  const activeSessionId = useActiveSessionId();
  const streamingIds = useStreamingSessionIds();
  const openSessionIds = useOpenSessionIds();
  const messagesMap = useAgentStore((state) => state.messages);

  const renameSession = useAgentStore((state) => state.renameSession);
  const deleteSession = useAgentStore((state) => state.deleteSession);

  // Workspace + worktree scoping — filters by repository path, then by worktree context
  const activeWorktreeId = useWorktreeStore((s) => s.activeWorktreeId);
  const currentRootPath = useFileExplorerStore((s) => s.rootPath);

  const scopedSessions = useMemo(() => {
    return sessions.filter((session) => {
      // Filter by workspace (repository) — prevents cross-repo session bleed
      if (currentRootPath && session.workspacePath) {
        if (!session.workspacePath.startsWith(currentRootPath)) {
          return false;
        }
      }
      // Filter by worktree context
      if (activeWorktreeId) {
        // In a worktree: show sessions bound to this worktree + unbound sessions
        return session.worktreeId === activeWorktreeId || !session.worktreeId;
      }
      // Main workspace: show only unbound sessions
      return !session.worktreeId;
    });
  }, [sessions, activeWorktreeId, currentRootPath]);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  // Rename state (shared hook)
  const rename = useInlineRename((id, value) => renameSession(id, value));

  // Filter scoped sessions by search query
  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return scopedSessions;
    const q = searchQuery.toLowerCase();
    return scopedSessions.filter((session) => {
      const title = getSessionTitle(session.id, session.name, messagesMap).toLowerCase();
      return title.includes(q);
    });
  }, [scopedSessions, searchQuery, messagesMap]);

  const handleDeleteSession = useCallback((sessionId: string) => {
    deleteSession(sessionId);
  }, [deleteSession]);

  // Empty state
  if (scopedSessions.length === 0) {
    const emptyMessage = activeWorktreeId
      ? 'No sessions in this worktree'
      : 'No sessions yet';
    const emptySubtext = activeWorktreeId
      ? 'Start a new session to work in this worktree'
      : 'Start a conversation with Claude';

    return (
      <motion.div
        className={cn('flex flex-col items-center justify-center h-full gap-3 p-6', className)}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      >
        <div className="w-12 h-12 rounded-2xl bg-muted/50 flex items-center justify-center">
          <MessageCircle className="w-6 h-6 text-muted-foreground/40" />
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{emptyMessage}</p>
          <p className="text-xs text-muted-foreground/60">{emptySubtext}</p>
        </div>
        <button
          onClick={onNewSession}
          className="mt-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 active:scale-95 transition-all duration-200"
        >
          New Session
        </button>
      </motion.div>
    );
  }

  return (
      <div className={cn('flex flex-col h-full', className)}>
        {/* New Session Button */}
        <div className="p-2 border-b border-border/30">
          <motion.button
            onClick={onNewSession}
            whileTap={{ scale: [1, 0.92, 1.03, 1] }}
            transition={{ duration: 0.3 }}
            className="w-full h-9 px-3 flex items-center gap-2 rounded-lg bg-primary text-primary-foreground hover:brightness-110 transition-[background-color] duration-200"
          >
            <PlusIcon width={16} height={16} />
            <span className="text-sm font-medium">New session</span>
          </motion.button>
        </div>

        {/* Search Input */}
        <div className="px-2 py-2">
          <div className="relative">
            <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sessions..."
              className="w-full h-8 pl-8 pr-3 text-sm bg-muted/40 border border-border/30 rounded-lg placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring transition-colors"
            />
          </div>
        </div>

        {/* Session List */}
        <div className="flex min-h-0 flex-1 flex-col">
          {filteredSessions.length === 0 ? (
            <motion.div
              className="flex flex-col items-center justify-center py-8 gap-1"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
            >
              <MagnifyingGlassIcon className="w-5 h-5 text-muted-foreground/30 mb-1" />
              <p className="text-sm text-muted-foreground/60">No sessions found</p>
              <p className="text-xs text-muted-foreground/40">Try a different search</p>
            </motion.div>
          ) : (
            <VirtualList
              items={filteredSessions}
              estimateSize={() => 56}
              overscan={10}
              className="min-h-0 flex-1 px-2 pb-2"
              itemClassName="pb-1"
              getItemKey={(session) => session.id}
              testId="agent-session-list"
              renderItem={(session) => (
                  <motion.div
                    key={session.id}
                    layout
                    initial={{ opacity: 0, scale: 0.9, y: -8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.1 } }}
                    transition={{
                      type: 'spring',
                      stiffness: 500,
                      damping: 30,
                      layout: { type: 'spring', stiffness: 500, damping: 35 },
                    }}
                  >
                    <SessionItem
                      session={session}
                      isActive={activeSessionId === session.id}
                      isStreaming={streamingIds.has(session.id)}
                      hasOpenTab={openSessionIds.has(session.id)}
                      isRenaming={rename.renamingId === session.id}
                      renameValue={rename.renameValue}
                      messagesMap={messagesMap}
                      onSelect={() => onSessionSelect(session.id)}
                      onStartRename={() => rename.startRename(session.id, session.name || getSessionTitle(session.id, undefined, messagesMap))}
                      onDoubleClickRename={() => rename.startRename(session.id, session.name || getSessionTitle(session.id, undefined, messagesMap))}
                      onCommitRename={rename.commitRename}
                      onCancelRename={rename.cancelRename}
                      onRenameChange={rename.setRenameValue}
                      onRequestDelete={() => handleDeleteSession(session.id)}
                    />
                  </motion.div>
              )}
            />
          )}
        </div>
      </div>
  );
};
