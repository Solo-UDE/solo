/**
 * Settings Store - Manages user preferences with persistence
 * Grouped by category: general, editor, files, shortcuts, ai
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

// Type definitions
export type ColorScheme = 'system' | 'light' | 'dark';
export type AutosaveDelay = 0 | 5000 | 10000 | 30000 | 'disabled';
export type LineNumbers = 'on' | 'off' | 'relative';
export type TabSize = 2 | 4 | 8;

export const FONT_FAMILIES = [
  { label: 'System Default', value: 'system-ui' },
  { label: 'SF Mono', value: '"SF Mono", SFMono-Regular' },
  { label: 'Menlo', value: 'Menlo' },
  { label: 'Monaco', value: 'Monaco' },
  { label: 'Consolas', value: 'Consolas' },
  { label: 'Fira Code', value: '"Fira Code"' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono"' },
  { label: 'Source Code Pro', value: '"Source Code Pro"' },
] as const;

export const AUTOSAVE_OPTIONS: { label: string; value: AutosaveDelay }[] = [
  { label: 'Immediate', value: 0 },
  { label: '5 seconds', value: 5000 },
  { label: '10 seconds', value: 10000 },
  { label: '30 seconds', value: 30000 },
  { label: 'Disabled', value: 'disabled' },
];

export const TAB_SIZE_OPTIONS: { label: string; value: TabSize }[] = [
  { label: '2 spaces', value: 2 },
  { label: '4 spaces', value: 4 },
  { label: '8 spaces', value: 8 },
];

export const LINE_NUMBER_OPTIONS: { label: string; value: LineNumbers }[] = [
  { label: 'On', value: 'on' },
  { label: 'Off', value: 'off' },
  { label: 'Relative', value: 'relative' },
];

// Settings state interfaces
interface GeneralSettings {
  colorScheme: ColorScheme;
  editorFontFamily: string;
  editorFontSize: number;
}

interface EditorSettings {
  tabSize: TabSize;
  wordWrap: boolean;
  minimap: boolean;
  lineNumbers: LineNumbers;
  bracketColorization: boolean;
}

interface FilesSettings {
  autosaveDelay: AutosaveDelay;
  showHiddenFiles: boolean;
}

interface ShortcutsSettings {
  keybindings: Record<string, string>;
}

interface AISettings {
  streaming: boolean;
  autoApproveTools: boolean;
  maxTokens: number;
  customApiUrl: string;
}

interface SettingsState {
  general: GeneralSettings;
  editor: EditorSettings;
  files: FilesSettings;
  shortcuts: ShortcutsSettings;
  ai: AISettings;
}

// Default values
const DEFAULT_SETTINGS: SettingsState = {
  general: {
    colorScheme: 'system',
    editorFontFamily: 'system-ui',
    editorFontSize: 13,
  },
  editor: {
    tabSize: 2,
    wordWrap: false,
    minimap: false,
    lineNumbers: 'on',
    bracketColorization: true,
  },
  files: {
    autosaveDelay: 5000,
    showHiddenFiles: false,
  },
  shortcuts: {
    keybindings: {},
  },
  ai: {
    streaming: true,
    autoApproveTools: false,
    maxTokens: 4096,
    customApiUrl: '',
  },
};

interface SettingsActions {
  // General
  setColorScheme: (scheme: ColorScheme) => void;
  setEditorFontFamily: (family: string) => void;
  setEditorFontSize: (size: number) => void;

  // Editor
  setTabSize: (size: TabSize) => void;
  setWordWrap: (enabled: boolean) => void;
  setMinimap: (enabled: boolean) => void;
  setLineNumbers: (mode: LineNumbers) => void;
  setBracketColorization: (enabled: boolean) => void;

  // Files
  setAutosaveDelay: (delay: AutosaveDelay) => void;
  setShowHiddenFiles: (show: boolean) => void;

  // Shortcuts
  setKeybinding: (action: string, keybinding: string) => void;
  resetKeybinding: (action: string) => void;
  resetAllKeybindings: () => void;

  // AI
  setStreaming: (enabled: boolean) => void;
  setAutoApproveTools: (enabled: boolean) => void;
  setMaxTokens: (tokens: number) => void;
  setCustomApiUrl: (url: string) => void;

  // Global
  resetToDefaults: () => void;
}

type SettingsStore = SettingsState & SettingsActions;

// Migration function to handle v1 → v2 upgrade
interface V1State {
  autosaveDelay: AutosaveDelay;
}

function migrateV1ToV2(persistedState: unknown): SettingsState {
  const v1 = persistedState as V1State | undefined;
  const newState = { ...DEFAULT_SETTINGS };

  // Preserve existing autosave delay from v1
  if (v1?.autosaveDelay !== undefined) {
    newState.files.autosaveDelay = v1.autosaveDelay;
  }

  return newState;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    immer((set) => ({
      ...DEFAULT_SETTINGS,

      // General actions
      setColorScheme: (scheme) =>
        set((s) => {
          s.general.colorScheme = scheme;
        }),

      setEditorFontFamily: (family) =>
        set((s) => {
          s.general.editorFontFamily = family;
        }),

      setEditorFontSize: (size) =>
        set((s) => {
          s.general.editorFontSize = Math.max(10, Math.min(24, size));
        }),

      // Editor actions
      setTabSize: (size) =>
        set((s) => {
          s.editor.tabSize = size;
        }),

      setWordWrap: (enabled) =>
        set((s) => {
          s.editor.wordWrap = enabled;
        }),

      setMinimap: (enabled) =>
        set((s) => {
          s.editor.minimap = enabled;
        }),

      setLineNumbers: (mode) =>
        set((s) => {
          s.editor.lineNumbers = mode;
        }),

      setBracketColorization: (enabled) =>
        set((s) => {
          s.editor.bracketColorization = enabled;
        }),

      // Files actions
      setAutosaveDelay: (delay) =>
        set((s) => {
          s.files.autosaveDelay = delay;
        }),

      setShowHiddenFiles: (show) =>
        set((s) => {
          s.files.showHiddenFiles = show;
        }),

      // Shortcuts actions
      setKeybinding: (action, keybinding) =>
        set((s) => {
          s.shortcuts.keybindings[action] = keybinding;
        }),

      resetKeybinding: (action) =>
        set((s) => {
          delete s.shortcuts.keybindings[action];
        }),

      resetAllKeybindings: () =>
        set((s) => {
          s.shortcuts.keybindings = {};
        }),

      // AI actions
      setStreaming: (enabled) =>
        set((s) => {
          s.ai.streaming = enabled;
        }),

      setAutoApproveTools: (enabled) =>
        set((s) => {
          s.ai.autoApproveTools = enabled;
        }),

      setMaxTokens: (tokens) =>
        set((s) => {
          s.ai.maxTokens = Math.max(1024, Math.min(32768, tokens));
        }),

      setCustomApiUrl: (url) =>
        set((s) => {
          s.ai.customApiUrl = url;
        }),

      // Global actions
      resetToDefaults: () =>
        set(() => ({ ...DEFAULT_SETTINGS })),
    })),
    {
      name: 'solo-settings',
      version: 2,
      storage: createJSONStorage(() => localStorage),
      migrate: (persistedState, version) => {
        if (version === 1) {
          return migrateV1ToV2(persistedState);
        }
        return persistedState as SettingsState;
      },
    }
  )
);

// Convenience selectors
export const useColorScheme = () => useSettingsStore((s) => s.general.colorScheme);
export const useEditorFontFamily = () => useSettingsStore((s) => s.general.editorFontFamily);
export const useEditorFontSize = () => useSettingsStore((s) => s.general.editorFontSize);
export const useTabSize = () => useSettingsStore((s) => s.editor.tabSize);
export const useWordWrap = () => useSettingsStore((s) => s.editor.wordWrap);
export const useMinimap = () => useSettingsStore((s) => s.editor.minimap);
export const useLineNumbers = () => useSettingsStore((s) => s.editor.lineNumbers);
export const useBracketColorization = () => useSettingsStore((s) => s.editor.bracketColorization);
export const useAutosaveDelay = () => useSettingsStore((s) => s.files.autosaveDelay);
export const useShowHiddenFiles = () => useSettingsStore((s) => s.files.showHiddenFiles);
export const useKeybindings = () => useSettingsStore((s) => s.shortcuts.keybindings);
export const useStreaming = () => useSettingsStore((s) => s.ai.streaming);
export const useAutoApproveTools = () => useSettingsStore((s) => s.ai.autoApproveTools);
export const useMaxTokens = () => useSettingsStore((s) => s.ai.maxTokens);
export const useCustomApiUrl = () => useSettingsStore((s) => s.ai.customApiUrl);
