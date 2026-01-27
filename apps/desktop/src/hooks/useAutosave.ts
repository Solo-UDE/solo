/**
 * useAutosave - Hook for automatic file saving on blur and tab switch
 */

import { useEffect, useRef, useCallback } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { useEditorStore } from '../stores/editorStore';
import * as fs from '../lib/tauri/fs';

/**
 * Saves all dirty files to disk
 */
async function saveAllDirty(): Promise<void> {
  const state = useEditorStore.getState();
  const dirtyTabs = state.getDirtyTabs();

  for (const path of dirtyTabs) {
    const tab = state.tabs.get(path);
    if (tab) {
      try {
        await fs.writeFile(path, tab.currentContent);
        state.markSaved(path);
      } catch (err) {
        console.error(`Failed to autosave ${path}:`, err);
      }
    }
  }
}

/**
 * Hook that manages autosave on window blur and tab switch
 */
export function useAutosave(): void {
  const autosaveDelay = useSettingsStore((s) => s.files.autosaveDelay);
  const activeTab = useEditorStore((s) => s.activeTab);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousTabRef = useRef<string | null>(null);
  const autosaveDelayRef = useRef(autosaveDelay);

  // Keep delay ref updated
  useEffect(() => {
    autosaveDelayRef.current = autosaveDelay;
  }, [autosaveDelay]);

  const scheduleAutosave = useCallback(() => {
    const delay = autosaveDelayRef.current;

    // Clear any pending autosave
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (delay === 'disabled') {
      return;
    }

    if (delay === 0) {
      saveAllDirty();
    } else {
      timeoutRef.current = setTimeout(() => {
        saveAllDirty();
        timeoutRef.current = null;
      }, delay);
    }
  }, []);

  // Handle window blur
  useEffect(() => {
    const handleBlur = () => {
      scheduleAutosave();
    };

    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('blur', handleBlur);
    };
  }, [scheduleAutosave]);

  // Handle tab switch
  useEffect(() => {
    if (previousTabRef.current !== null && previousTabRef.current !== activeTab) {
      scheduleAutosave();
    }
    previousTabRef.current = activeTab;
  }, [activeTab, scheduleAutosave]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);
}
