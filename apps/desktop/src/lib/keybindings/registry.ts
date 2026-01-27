/**
 * Keybindings Registry - Default keybindings organized by category
 */

export interface KeybindingDefinition {
  id: string;
  label: string;
  description?: string;
  defaultKey: string;
  category: string;
}

export interface KeybindingCategory {
  id: string;
  label: string;
  bindings: KeybindingDefinition[];
}

export const DEFAULT_KEYBINDINGS: KeybindingDefinition[] = [
  // Editor
  { id: 'editor.save', label: 'Save File', description: 'Save the current file', defaultKey: 'Cmd+S', category: 'editor' },
  { id: 'editor.saveAll', label: 'Save All', description: 'Save all open files', defaultKey: 'Cmd+Shift+S', category: 'editor' },
  { id: 'editor.undo', label: 'Undo', description: 'Undo last action', defaultKey: 'Cmd+Z', category: 'editor' },
  { id: 'editor.redo', label: 'Redo', description: 'Redo last undone action', defaultKey: 'Cmd+Shift+Z', category: 'editor' },
  { id: 'editor.find', label: 'Find', description: 'Open find dialog', defaultKey: 'Cmd+F', category: 'editor' },
  { id: 'editor.replace', label: 'Find and Replace', description: 'Open find and replace dialog', defaultKey: 'Cmd+H', category: 'editor' },
  { id: 'editor.format', label: 'Format Document', description: 'Format the current document', defaultKey: 'Cmd+Shift+F', category: 'editor' },
  { id: 'editor.comment', label: 'Toggle Comment', description: 'Comment/uncomment selection', defaultKey: 'Cmd+/', category: 'editor' },

  // File
  { id: 'file.new', label: 'New File', description: 'Create a new file', defaultKey: 'Cmd+N', category: 'file' },
  { id: 'file.open', label: 'Open File', description: 'Open a file', defaultKey: 'Cmd+O', category: 'file' },
  { id: 'file.openFolder', label: 'Open Folder', description: 'Open a folder', defaultKey: 'Cmd+Shift+O', category: 'file' },
  { id: 'file.closeTab', label: 'Close Tab', description: 'Close the current tab', defaultKey: 'Cmd+W', category: 'file' },
  { id: 'file.closeAllTabs', label: 'Close All Tabs', description: 'Close all open tabs', defaultKey: 'Cmd+Shift+W', category: 'file' },

  // View
  { id: 'view.toggleSidebar', label: 'Toggle Sidebar', description: 'Show/hide the sidebar', defaultKey: 'Cmd+B', category: 'view' },
  { id: 'view.toggleTerminal', label: 'Toggle Terminal', description: 'Show/hide the terminal', defaultKey: 'Cmd+`', category: 'view' },
  { id: 'view.zoomIn', label: 'Zoom In', description: 'Increase editor zoom', defaultKey: 'Cmd+=', category: 'view' },
  { id: 'view.zoomOut', label: 'Zoom Out', description: 'Decrease editor zoom', defaultKey: 'Cmd+-', category: 'view' },
  { id: 'view.resetZoom', label: 'Reset Zoom', description: 'Reset editor zoom', defaultKey: 'Cmd+0', category: 'view' },

  // Navigation
  { id: 'nav.goToFile', label: 'Go to File', description: 'Quick open file by name', defaultKey: 'Cmd+P', category: 'navigation' },
  { id: 'nav.goToLine', label: 'Go to Line', description: 'Jump to a specific line', defaultKey: 'Cmd+G', category: 'navigation' },
  { id: 'nav.goToSymbol', label: 'Go to Symbol', description: 'Jump to a symbol in file', defaultKey: 'Cmd+Shift+O', category: 'navigation' },
  { id: 'nav.nextTab', label: 'Next Tab', description: 'Switch to next tab', defaultKey: 'Cmd+Shift+]', category: 'navigation' },
  { id: 'nav.prevTab', label: 'Previous Tab', description: 'Switch to previous tab', defaultKey: 'Cmd+Shift+[', category: 'navigation' },
  { id: 'nav.goBack', label: 'Go Back', description: 'Navigate back', defaultKey: 'Cmd+Alt+Left', category: 'navigation' },
  { id: 'nav.goForward', label: 'Go Forward', description: 'Navigate forward', defaultKey: 'Cmd+Alt+Right', category: 'navigation' },
];

export const KEYBINDING_CATEGORIES: KeybindingCategory[] = [
  {
    id: 'editor',
    label: 'Editor',
    bindings: DEFAULT_KEYBINDINGS.filter((b) => b.category === 'editor'),
  },
  {
    id: 'file',
    label: 'File',
    bindings: DEFAULT_KEYBINDINGS.filter((b) => b.category === 'file'),
  },
  {
    id: 'view',
    label: 'View',
    bindings: DEFAULT_KEYBINDINGS.filter((b) => b.category === 'view'),
  },
  {
    id: 'navigation',
    label: 'Navigation',
    bindings: DEFAULT_KEYBINDINGS.filter((b) => b.category === 'navigation'),
  },
];

/**
 * Get conflicts between keybindings.
 * Returns a map of binding ID to array of conflicting binding IDs.
 */
export function getKeybindingConflicts(
  keybindings: Record<string, string>
): Record<string, string[]> {
  const conflicts: Record<string, string[]> = {};
  const keyToIds: Record<string, string[]> = {};

  // Build map of key combinations to binding IDs
  for (const [id, key] of Object.entries(keybindings)) {
    if (!key) continue;
    const normalized = normalizeKeybinding(key);
    if (!keyToIds[normalized]) {
      keyToIds[normalized] = [];
    }
    keyToIds[normalized].push(id);
  }

  // Find conflicts (keys used by multiple bindings)
  for (const [_, ids] of Object.entries(keyToIds)) {
    if (ids.length > 1) {
      for (const id of ids) {
        conflicts[id] = ids.filter((otherId) => otherId !== id);
      }
    }
  }

  return conflicts;
}

/**
 * Normalize a keybinding string for comparison.
 * Handles different modifier orders and case differences.
 */
export function normalizeKeybinding(key: string): string {
  const parts = key.split('+').map((p) => p.trim().toLowerCase());

  // Sort modifiers in a consistent order
  const modifierOrder = ['cmd', 'ctrl', 'alt', 'shift'];
  const modifiers: string[] = [];
  let mainKey = '';

  for (const part of parts) {
    if (modifierOrder.includes(part)) {
      modifiers.push(part);
    } else {
      mainKey = part;
    }
  }

  modifiers.sort((a, b) => modifierOrder.indexOf(a) - modifierOrder.indexOf(b));
  return [...modifiers, mainKey].join('+');
}

/**
 * Format a keybinding for display.
 */
export function formatKeybinding(key: string): string {
  return key
    .split('+')
    .map((part) => {
      switch (part.toLowerCase()) {
        case 'cmd':
          return '⌘';
        case 'ctrl':
          return '⌃';
        case 'alt':
          return '⌥';
        case 'shift':
          return '⇧';
        default:
          return part;
      }
    })
    .join('');
}
