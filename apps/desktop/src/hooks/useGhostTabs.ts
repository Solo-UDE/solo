/**
 * Ghost Tab Hooks
 * Tabs untouched for 30+ minutes are considered "ghosts" and visually fade out.
 * Clicking a ghost tab revives it (updates lastAccessed via setActiveTab).
 */

import { useEffect, useState } from 'react';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import type { PanelInstanceId, TileId } from '@/lib/panels/types';

const GHOST_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const CHECK_INTERVAL_MS = 60 * 1000; // Re-check every 60 seconds

/**
 * Returns true if the tab has been inactive for 30+ minutes.
 * Re-evaluates on a 60s interval.
 */
export function useIsGhostTab(instanceId: PanelInstanceId): boolean {
  const lastAccessed = usePanelTabsStore(
    (state) => state.instances.get(instanceId)?.lastAccessed ?? 0,
  );

  const [isGhost, setIsGhost] = useState(() => {
    return Date.now() - lastAccessed > GHOST_THRESHOLD_MS;
  });

  useEffect(() => {
    // Immediately check on lastAccessed change
    const check = () => setIsGhost(Date.now() - lastAccessed > GHOST_THRESHOLD_MS);
    check();

    const interval = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [lastAccessed]);

  return isGhost;
}

/**
 * Returns the count of ghost tabs in a tile (for the sweep button badge).
 * Re-evaluates on a 60s interval.
 */
export function useGhostTabCount(tileId: TileId): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const compute = () => {
      const state = usePanelTabsStore.getState();
      const tileState = state.tileTabs.get(tileId);
      if (!tileState) {
        setCount(0);
        return;
      }

      const now = Date.now();
      let ghostCount = 0;
      for (const tabId of tileState.tabs) {
        const inst = state.instances.get(tabId);
        if (!inst || inst.isPinned) continue;
        if (now - inst.lastAccessed > GHOST_THRESHOLD_MS) {
          ghostCount++;
        }
      }
      setCount(ghostCount);
    };

    compute();

    // Re-check periodically and also when the store changes
    const interval = setInterval(compute, CHECK_INTERVAL_MS);
    const unsub = usePanelTabsStore.subscribe(compute);

    return () => {
      clearInterval(interval);
      unsub();
    };
  }, [tileId]);

  return count;
}
