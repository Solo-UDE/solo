/**
 * useAgentTabState — derived state for agent tab collapse and attention behavior.
 * Combines streaming and pending-permission signals into a single hook
 * so Tab.tsx stays clean and the logic is testable/reusable.
 */

import { useIsSessionStreaming, useSessionNeedsAttention } from '@/stores/agentStore';

export function useAgentTabState(sessionId: string | null) {
  const isStreaming = useIsSessionStreaming(sessionId);
  const needsAttention = useSessionNeedsAttention(sessionId);
  return { isStreaming, needsAttention };
}
