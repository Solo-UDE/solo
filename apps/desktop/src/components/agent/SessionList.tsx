/**
 * SessionList - Compact session list for sidebar
 * Shows all sessions with ability to create new ones and switch between them
 */

import { useRef } from 'react';
import { Plus, MessageSquare } from 'lucide-react';
import { useAgentStore, useSessions, useActiveSessionId } from '@/stores/agentStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import { BUILTIN_PANEL_TYPES } from '@/lib/panels';
import { cn } from '@/lib/utils';

import type { FC } from 'react';

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
 * Compact session list component for sidebar
 * Displays all sessions and allows creating new ones
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

  // Empty state - centered like Explorer
  if (sessions.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center h-full gap-4 p-4', className)}>
        <MessageSquare className="w-12 h-12 text-muted-foreground/50" />
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
          className="w-full h-9 px-3 flex items-center gap-2 rounded-lg bg-primary text-primary-foreground hover:brightness-110 active:scale-[0.97] transition-all duration-200"
        >
          <Plus className="h-4 w-4" />
          <span className="text-sm font-medium">New session</span>
        </button>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-1">
          {sessions.map((session) => {
            const isStreaming = streamingIds.has(session.id);
            const hasOpenTab = openSessionIds.has(session.id);

            return (
              <button
                key={session.id}
                onClick={() => onSessionSelect(session.id)}
                className={cn(
                  'w-full px-3 py-2 flex items-center gap-2 rounded-lg text-left transition-all duration-150',
                  'hover:bg-muted/60 hover:scale-[1.02] active:scale-[0.97]',
                  activeSessionId === session.id
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {/* Streaming indicator — pulsing dot */}
                {isStreaming && (
                  <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />
                )}

                <MessageSquare
                  className={cn(
                    'h-4 w-4 shrink-0',
                    hasOpenTab ? 'text-primary' : ''
                  )}
                />
                <div className="flex-1 min-w-0">
                  <span className="text-sm truncate block">
                    {formatSessionDate(session.createdAt)}
                  </span>
                  <span className="text-xs text-muted-foreground/60 truncate block">
                    {session.model.split('-').slice(0, 2).join(' ')}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

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
