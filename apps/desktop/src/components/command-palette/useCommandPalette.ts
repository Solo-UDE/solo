/**
 * useCommandPalette - Hook for command palette state and actions
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useUIStore } from '@/stores/uiStore';
import { useEditorStore } from '@/stores/editorStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import { BUILTIN_PANEL_TYPES } from '@/lib/panels';

export type CommandCategory = 'recent' | 'files' | 'commands' | 'settings';

export interface CommandItem {
  id: string;
  label: string;
  description?: string;
  category: CommandCategory;
  shortcut?: string;
  icon?: string;
  action: () => void;
}

interface UseCommandPaletteReturn {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  query: string;
  setQuery: (query: string) => void;
  filteredItems: CommandItem[];
  selectedIndex: number;
  setSelectedIndex: (index: number) => void;
  executeSelected: () => void;
  moveUp: () => void;
  moveDown: () => void;
}

export function useCommandPalette(): UseCommandPaletteReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Store actions - use stable references
  const setActiveTab = useUIStore((state) => state.setActiveTab);
  const setLeftSidebarWidth = useUIStore((state) => state.setLeftSidebarWidth);
  const openPanelRef = useRef(usePanelTabsStore.getState().openPanel);

  // Use useShallow to prevent infinite loops with array selectors
  const recentFiles = useEditorStore(
    useShallow((state) => Array.from(state.tabs.keys()).slice(0, 10))
  );

  // Build command items
  const allItems = useMemo((): CommandItem[] => {
    const items: CommandItem[] = [];
    const openPanel = openPanelRef.current;

    // Recent files
    recentFiles.forEach((filePath) => {
      const fileName = filePath.split('/').pop() || filePath;
      items.push({
        id: `file:${filePath}`,
        label: fileName,
        description: filePath,
        category: 'recent',
        action: () => {
          openPanel(BUILTIN_PANEL_TYPES.FILE_VIEWER, { filePath, fileName });
        },
      });
    });

    // Commands
    const commands: CommandItem[] = [
      {
        id: 'cmd:toggle-explorer',
        label: 'Toggle Explorer',
        description: 'Show/hide the file explorer',
        category: 'commands',
        shortcut: '⌘B',
        action: () => {
          setActiveTab('explorer');
          setLeftSidebarWidth(256);
        },
      },
      {
        id: 'cmd:toggle-sessions',
        label: 'Toggle Sessions',
        description: 'Show/hide the sessions panel',
        category: 'commands',
        shortcut: '⌘J',
        action: () => {
          setActiveTab('sessions');
          setLeftSidebarWidth(256);
        },
      },
      {
        id: 'cmd:new-session',
        label: 'New AI Session',
        description: 'Create a new AI chat session',
        category: 'commands',
        shortcut: '⌘N',
        action: () => {
          // This will be handled by the agent store
          setActiveTab('sessions');
          setLeftSidebarWidth(256);
        },
      },
      {
        id: 'cmd:close-sidebar',
        label: 'Close Sidebar',
        description: 'Collapse the sidebar',
        category: 'commands',
        action: () => {
          setLeftSidebarWidth(0);
        },
      },
    ];

    items.push(...commands);

    // Settings
    const settings: CommandItem[] = [
      {
        id: 'settings:general',
        label: 'Preferences: Open Settings',
        description: 'Open the settings panel',
        category: 'settings',
        shortcut: '⌘,',
        action: () => {
          // Settings will be opened via event
          window.dispatchEvent(new CustomEvent('open-settings'));
        },
      },
      {
        id: 'settings:theme',
        label: 'Preferences: Color Theme',
        description: 'Change the color theme',
        category: 'settings',
        action: () => {
          window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'general' } }));
        },
      },
    ];

    items.push(...settings);

    return items;
  }, [recentFiles, setActiveTab, setLeftSidebarWidth]);

  // Filter items based on query
  const filteredItems = useMemo(() => {
    if (!query.trim()) {
      // Show recent files and some commands when no query
      return allItems.slice(0, 10);
    }

    const lowerQuery = query.toLowerCase();
    return allItems
      .filter((item) => {
        const labelMatch = item.label.toLowerCase().includes(lowerQuery);
        const descMatch = item.description?.toLowerCase().includes(lowerQuery);
        return labelMatch || descMatch;
      })
      .slice(0, 20);
  }, [allItems, query]);

  // Reset selection when filtered items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredItems.length]);

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
    setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredItems.length - 1));
  }, [filteredItems.length]);

  const moveDown = useCallback(() => {
    setSelectedIndex((prev) => (prev < filteredItems.length - 1 ? prev + 1 : 0));
  }, [filteredItems.length]);

  // Execute selected command
  const executeSelected = useCallback(() => {
    const item = filteredItems[selectedIndex];
    if (item) {
      item.action();
      close();
    }
  }, [filteredItems, selectedIndex, close]);

  // Global keyboard shortcut (Cmd+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
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
    filteredItems,
    selectedIndex,
    setSelectedIndex,
    executeSelected,
    moveUp,
    moveDown,
  };
}
