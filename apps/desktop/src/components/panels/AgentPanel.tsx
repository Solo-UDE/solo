/**
 * AgentPanel - Panel implementation for AI agent chat sessions
 * Wraps the AgentWindow component for use in the panel system
 */

import { useEffect, useRef } from 'react';
import { AgentWindow } from '@/components/agent';
import { useAgentStore } from '@/stores/agentStore';
import { useWorktreeStore } from '@/stores/worktreeStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import type { PanelProps } from '@/lib/panels/types';

interface AgentPanelData {
  sessionId?: string;
  worktreeId?: string | null;
}

/**
 * Generate a tab title from the session's first user message
 * Falls back to "New Session" if no messages exist
 */
function getSessionTitle(sessionId: string | undefined): string {
  if (!sessionId) return 'New Session';

  const store = useAgentStore.getState();
  const session = store.sessions.get(sessionId);

  // Use custom name if set
  if (session?.name) return session.name;

  const messages = store.messages.get(sessionId);

  if (!messages || messages.length === 0) return 'New Session';

  // Find the first user message
  const firstUserMessage = messages.find((m) => m.role === 'user');
  if (!firstUserMessage) return 'New Session';

  // Truncate to ~30 chars
  const content = firstUserMessage.content;
  if (content.length <= 30) return content;
  return content.slice(0, 30) + '...';
}

export function AgentPanel({
  instanceId,
  data,
  isActive,
  onTitleChange,
}: PanelProps<AgentPanelData>) {
  const sessionId = data?.sessionId;
  const worktreeId = data?.worktreeId;
  const deletedRef = useRef(false);
  const pendingDeleteRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync activeSessionId and active worktree when this tab is focused
  useEffect(() => {
    if (isActive && sessionId) {
      useAgentStore.getState().setActiveSession(sessionId);
    }
    if (isActive) {
      useWorktreeStore.getState().setActive(worktreeId ?? null);
    }
  }, [isActive, sessionId, worktreeId]);

  // Update title based on session content
  useEffect(() => {
    const title = getSessionTitle(sessionId);
    onTitleChange(title);
  }, [sessionId, onTitleChange]);

  // Subscribe to session changes to update title when messages are added
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = useAgentStore.subscribe((state) => {
      const session = state.sessions.get(sessionId);
      if (session) {
        const title = getSessionTitle(sessionId);
        onTitleChange(title);
      }
    });

    return unsubscribe;
  }, [sessionId, onTitleChange]);

  // Auto-delete empty sessions on unmount (deferred to survive StrictMode double-mount)
  useEffect(() => {
    if (pendingDeleteRef.current !== null) {
      clearTimeout(pendingDeleteRef.current);
      pendingDeleteRef.current = null;
    }

    return () => {
      if (sessionId && !deletedRef.current) {
        pendingDeleteRef.current = setTimeout(() => {
          // Only delete if the tab was actually closed, not just unmounted by a view transition
          const tabStillExists = usePanelTabsStore.getState().instances.has(instanceId);
          if (tabStillExists) return;

          const store = useAgentStore.getState();
          const messages = store.messages.get(sessionId);
          if (!messages || messages.length === 0) {
            deletedRef.current = true;
            store.deleteSession(sessionId);
          }
        }, 50);
      }
    };
  }, [sessionId]);

  return (
    <AgentWindow
      instanceId={instanceId}
      initialSessionId={sessionId}
      initialWorktreeId={worktreeId}
      className="h-full"
    />
  );
}
