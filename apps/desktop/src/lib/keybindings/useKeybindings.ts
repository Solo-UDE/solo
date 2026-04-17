/**
 * useKeybindings - Hook to register and handle global keybindings
 */

import { useEffect, useCallback, useMemo } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { getEffectiveKeybinding } from './registry';
import { matchesKeybinding } from './utils';

type KeybindingHandler = () => void;

/**
 * Hook to listen for a specific keybinding.
 */
export function useKeybinding(
  actionId: string,
  handler: KeybindingHandler,
  enabled = true
): void {
  const customKeybindings = useSettingsStore((s) => s.shortcuts.keybindings);

  // Get the effective keybinding (custom or default)
  const keybinding = useMemo(
    () => getEffectiveKeybinding(actionId, customKeybindings),
    [actionId, customKeybindings]
  );

  useEffect(() => {
    if (!enabled || !keybinding) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (matchesKeybinding(keybinding, e)) {
        e.preventDefault();
        handler();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [keybinding, handler, enabled]);
}

/**
 * Hook to register multiple keybindings at once.
 */
export function useKeybindings(
  handlers: Record<string, KeybindingHandler>,
  enabled = true
): void {
  const customKeybindings = useSettingsStore((s) => s.shortcuts.keybindings);

  // Build a map of keybindings to action IDs
  const keybindingMap = useMemo(() => {
    const map = new Map<string, string>();

    for (const actionId of Object.keys(handlers)) {
      const keybinding = getEffectiveKeybinding(actionId, customKeybindings);
      if (keybinding) {
        map.set(keybinding, actionId);
      }
    }

    return map;
  }, [handlers, customKeybindings]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      for (const [keybinding, actionId] of keybindingMap) {
        if (matchesKeybinding(keybinding, e)) {
          e.preventDefault();
          handlers[actionId]?.();
          return;
        }
      }
    },
    [keybindingMap, handlers, enabled]
  );

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, enabled]);
}

/**
 * Get the effective keybinding for an action.
 */
export function useEffectiveKeybinding(actionId: string): string {
  const customKeybindings = useSettingsStore((s) => s.shortcuts.keybindings);

  return useMemo(
    () => getEffectiveKeybinding(actionId, customKeybindings),
    [actionId, customKeybindings]
  );
}
