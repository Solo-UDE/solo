/**
 * SessionList - Compact session list for sidebar
 * Shows all sessions with ability to create new ones and switch between them
 */

import { Plus, MessageSquare } from 'lucide-react';
import { useSessions, useActiveSessionId } from '@/stores/agentStore';
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
        {sessions.length === 0 ? (
          <div className="text-center py-8">
            <MessageSquare className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No sessions yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Click "New session" to start
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {sessions.map((session) => (
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
                <MessageSquare className="h-4 w-4 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm truncate block">
                    {formatSessionDate(session.createdAt)}
                  </span>
                  <span className="text-xs text-muted-foreground/60 truncate block">
                    {session.model.split('-').slice(0, 2).join(' ')}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
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
