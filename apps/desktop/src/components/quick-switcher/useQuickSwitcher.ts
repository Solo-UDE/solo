/**
 * useQuickSwitcher - Hook for quick file switcher state (Cmd+P)
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useEditorStore } from '@/stores/editorStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import { BUILTIN_PANEL_TYPES } from '@/lib/panels';
import { readDirectory } from '@/lib/tauri/fs';
import type { FileTreeEntry } from '@/bindings';

export interface QuickSwitcherItem {
  id: string;
  name: string;
  path: string;
  isRecent: boolean;
}

interface UseQuickSwitcherReturn {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  query: string;
  setQuery: (query: string) => void;
  items: QuickSwitcherItem[];
  selectedIndex: number;
  setSelectedIndex: (index: number) => void;
  executeSelected: () => void;
  moveUp: () => void;
  moveDown: () => void;
  isLoading: boolean;
}

/**
 * Fuzzy match a query against a file name
 */
function fuzzyMatch(query: string, text: string): boolean {
  const lowerQuery = query.toLowerCase();
  const lowerText = text.toLowerCase();

  // Check for substring match first
  if (lowerText.includes(lowerQuery)) {
    return true;
  }

  // Fuzzy character match
  let queryIndex = 0;
  for (let i = 0; i < lowerText.length && queryIndex < lowerQuery.length; i++) {
    if (lowerText[i] === lowerQuery[queryIndex]) {
      queryIndex++;
    }
  }

  return queryIndex === lowerQuery.length;
}

/**
 * Recursively collect files from directory tree
 */
function collectFiles(
  entries: FileTreeEntry[],
  recentFiles: string[],
  collected: QuickSwitcherItem[],
  maxDepth: number = 4,
  currentDepth: number = 0
): void {
  if (currentDepth > maxDepth) return;

  for (const entry of entries) {
    // Skip hidden files
    if (entry.name.startsWith('.')) continue;

    if (!entry.is_dir) {
      collected.push({
        id: entry.path,
        name: entry.name,
        path: entry.path,
        isRecent: recentFiles.includes(entry.path),
      });
    }

    // Recurse into directories
    if (entry.is_dir && entry.children) {
      collectFiles(entry.children, recentFiles, collected, maxDepth, currentDepth + 1);
    }
  }
}

export function useQuickSwitcher(): UseQuickSwitcherReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [allFiles, setAllFiles] = useState<QuickSwitcherItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Store actions - use stable references
  const openPanelRef = useRef(usePanelTabsStore.getState().openPanel);

  // Use useShallow to prevent infinite loops with array selectors
  const recentFiles = useEditorStore(
    useShallow((state) => Array.from(state.tabs.keys()).slice(0, 10))
  );

  // Load files when opened
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    async function loadFiles() {
      setIsLoading(true);
      try {
        // Read directory with depth 3 for nested files
        const result = await readDirectory('.', 3);
        if (cancelled) return;

        const files: QuickSwitcherItem[] = [];
        // Root entry contains children
        if (result.entry.children) {
          collectFiles(result.entry.children, recentFiles, files);
        }
        setAllFiles(files);
      } catch (err) {
        console.error('Failed to load files:', err);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadFiles();

    return () => {
      cancelled = true;
    };
  }, [isOpen, recentFiles]);

  // Filter and sort items
  const items = useMemo(() => {
    // Build recent files list
    const recentItems: QuickSwitcherItem[] = recentFiles.map((path) => ({
      id: `recent:${path}`,
      name: path.split('/').pop() || path,
      path,
      isRecent: true,
    }));

    if (!query.trim()) {
      // No query - show recent files first, then some other files
      const otherFiles = allFiles
        .filter((f) => !recentFiles.includes(f.path))
        .slice(0, 10);
      return [...recentItems, ...otherFiles];
    }

    // Filter by fuzzy match
    const matchedFiles = allFiles.filter((f) => fuzzyMatch(query, f.name));

    // Sort: recent first, then by name
    return matchedFiles
      .sort((a, b) => {
        if (a.isRecent && !b.isRecent) return -1;
        if (!a.isRecent && b.isRecent) return 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 20);
  }, [allFiles, recentFiles, query]);

  // Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [items.length, query]);

  // Open/close handlers
  const open = useCallback(() => {
    setIsOpen(true);
    setQuery('');
    setSelectedIndex(0);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
  }, []);

  const toggle = useCallback(() => {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }, [isOpen, open, close]);

  // Navigation
  const moveUp = useCallback(() => {
    setSelectedIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
  }, [items.length]);

  const moveDown = useCallback(() => {
    setSelectedIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
  }, [items.length]);

  // Execute selected item
  const executeSelected = useCallback(() => {
    const item = items[selectedIndex];
    if (item) {
      openPanelRef.current(BUILTIN_PANEL_TYPES.FILE_VIEWER, {
        filePath: item.path,
        fileName: item.name,
      });
      close();
    }
  }, [items, selectedIndex, close]);

  // Global keyboard shortcut (Cmd+P)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault();
        toggle();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggle]);

  return {
    isOpen,
    open,
    close,
    toggle,
    query,
    setQuery,
    items,
    selectedIndex,
    setSelectedIndex,
    executeSelected,
    moveUp,
    moveDown,
    isLoading,
  };
}
