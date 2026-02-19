/**
 * SessionList - ChatGPT-style session list for sidebar
 * Shows all sessions with titles from first message, context menu, search, and sorting
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Plus, ChatTeardrop, DotsThree, PencilSimple, Trash, MagnifyingGlass } from '@phosphor-icons/react';
import { useAgentStore, useSessions, useActiveSessionId } from '@/stores/agentStore';
import type { Message } from '@/stores/agentStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import { BUILTIN_PANEL_TYPES } from '@/lib/panels/constants';
import { useInlineRename } from '@/hooks/useInlineRename';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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
    <div className="group relative">
      <button
        onClick={() => {
          if (!isRenaming) onSelect();
        }}
        onDoubleClick={onDoubleClickRename}
        className={cn(
          'w-full px-3 py-2 flex items-center gap-2 rounded-lg text-left transition-[background-color,color] duration-150',
          'hover:bg-muted/60 hover:scale-[1.02] active:scale-[0.97]',
          isActive
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        {isStreaming && (
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />
        )}

        <ChatTeardrop
          className={cn(
            'h-4 w-4 shrink-0',
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
              <span className="text-sm truncate block">{title}</span>
              <span className="text-xs text-muted-foreground/60 truncate block">
                {formatSessionDate(session.createdAt)}
              </span>
            </>
          )}
        </div>
      </button>

      {/* Three-dot context menu — visible on hover */}
      {!isRenaming && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="p-1 rounded-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <DotsThree className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" className="w-44">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onStartRename();
                }}
              >
                <PencilSimple className="h-3.5 w-3.5" />
                <span>Rename</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onRequestDelete();
                }}
                className="text-destructive focus:text-destructive"
              >
                <Trash className="h-3.5 w-3.5" />
                <span>Delete</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
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

  // Search state
  const [searchQuery, setSearchQuery] = useState('');

  // Rename state (shared hook)
  const rename = useInlineRename((id, value) => renameSession(id, value));

  // Filter sessions by search query
  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter((session) => {
      const title = getSessionTitle(session.id, session.name, messagesMap).toLowerCase();
      return title.includes(q);
    });
  }, [sessions, searchQuery, messagesMap]);

  const handleDeleteSession = useCallback((sessionId: string) => {
    deleteSession(sessionId);
  }, [deleteSession]);

  // Empty state
  if (sessions.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center h-full gap-4 p-4', className)}>
        <ChatTeardrop className="w-12 h-12 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground text-center">
          Start a new session to chat
        </p>
        <button
          onClick={onNewSession}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          New Session
        </button>
      </div>
    );
  }

  return (
      <div className={cn('flex flex-col h-full', className)}>
        {/* New Session Button */}
        <div className="p-2 border-b border-border/30">
          <button
            onClick={onNewSession}
            className="w-full h-9 px-3 flex items-center gap-2 rounded-lg bg-primary text-primary-foreground hover:brightness-110 active:scale-[0.97] transition-[transform,background-color] duration-200"
          >
            <Plus className="h-4 w-4" />
            <span className="text-sm font-medium">New session</span>
          </button>
        </div>

        {/* Search Input */}
        <div className="px-2 py-2">
          <div className="relative">
            <MagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
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
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {filteredSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/60">
              <p className="text-sm">No sessions found</p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredSessions.map((session, i) => (
                <div
                  key={session.id}
                  className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200"
                  style={{ animationDelay: `${Math.min(i * 30, 300)}ms`, animationFillMode: 'backwards' }}
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
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
  );
};
