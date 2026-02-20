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
export type CursorStyle = 'line' | 'block' | 'underline';
export type RenderWhitespace = 'none' | 'boundary' | 'all';
export type LineEnding = 'lf' | 'crlf' | 'auto';

export const FONT_FAMILIES = [
  { label: 'SF Mono', value: '"SF Mono", SFMono-Regular, ui-monospace, monospace' },
  { label: 'Menlo', value: 'Menlo, Monaco, ui-monospace, monospace' },
  { label: 'System Default', value: 'ui-monospace, system-ui, monospace' },
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

export const CURSOR_STYLE_OPTIONS: { label: string; value: CursorStyle }[] = [
  { label: 'Line', value: 'line' },
  { label: 'Block', value: 'block' },
  { label: 'Underline', value: 'underline' },
];

export const RENDER_WHITESPACE_OPTIONS: { label: string; value: RenderWhitespace }[] = [
  { label: 'None', value: 'none' },
  { label: 'Boundary', value: 'boundary' },
  { label: 'All', value: 'all' },
];

export const LINE_ENDING_OPTIONS: { label: string; value: LineEnding }[] = [
  { label: 'LF (Unix)', value: 'lf' },
  { label: 'CRLF (Windows)', value: 'crlf' },
  { label: 'Auto', value: 'auto' },
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
  insertSpaces: boolean;
  cursorStyle: CursorStyle;
  renderWhitespace: RenderWhitespace;
  fontLigatures: boolean;
  smoothScrolling: boolean;
}

interface TerminalSettings {
  fontFamily: string;
  fontSize: number;
  scrollback: number;
  cursorStyle: CursorStyle;
  shell: string;
}

interface FilesSettings {
  autosaveDelay: AutosaveDelay;
  showHiddenFiles: boolean;
  trimTrailingWhitespace: boolean;
  insertFinalNewline: boolean;
  defaultLineEnding: LineEnding;
  excludePatterns: string;
}

interface ShortcutsSettings {
  keybindings: Record<string, string>;
}

interface AISettings {
  streaming: boolean;
  autoApproveTools: boolean;
  maxTokens: number;
  customApiUrl: string;
  /** Days to keep old sessions (0 = infinite). Default 30. */
  sessionRetentionDays: number;
}

interface SettingsState {
  general: GeneralSettings;
  editor: EditorSettings;
  terminal: TerminalSettings;
  files: FilesSettings;
  shortcuts: ShortcutsSettings;
  ai: AISettings;
}

// Default values
const DEFAULT_SETTINGS: SettingsState = {
  general: {
    colorScheme: 'system',
    editorFontFamily: '"SF Mono", SFMono-Regular, ui-monospace, monospace',
    editorFontSize: 13,
  },
  editor: {
    tabSize: 2,
    wordWrap: false,
    minimap: false,
    lineNumbers: 'on',
    bracketColorization: true,
    insertSpaces: true,
    cursorStyle: 'line',
    renderWhitespace: 'none',
    fontLigatures: false,
    smoothScrolling: true,
  },
  terminal: {
    fontFamily: '"SF Mono", SFMono-Regular, ui-monospace, monospace',
    fontSize: 13,
    scrollback: 10000,
    cursorStyle: 'line',
    shell: '',
  },
  files: {
    autosaveDelay: 5000,
    showHiddenFiles: false,
    trimTrailingWhitespace: false,
    insertFinalNewline: false,
    defaultLineEnding: 'auto',
    excludePatterns: 'node_modules, .git, target, dist, .next, __pycache__, .DS_Store',
  },
  shortcuts: {
    keybindings: {},
  },
  ai: {
    streaming: true,
    autoApproveTools: false,
    maxTokens: 4096,
    customApiUrl: '',
    sessionRetentionDays: 30,
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
  setInsertSpaces: (enabled: boolean) => void;
  setEditorCursorStyle: (style: CursorStyle) => void;
  setRenderWhitespace: (mode: RenderWhitespace) => void;
  setFontLigatures: (enabled: boolean) => void;
  setSmoothScrolling: (enabled: boolean) => void;

  // Terminal
  setTerminalFontFamily: (family: string) => void;
  setTerminalFontSize: (size: number) => void;
  setTerminalScrollback: (lines: number) => void;
  setTerminalCursorStyle: (style: CursorStyle) => void;
  setTerminalShell: (shell: string) => void;

  // Files
  setAutosaveDelay: (delay: AutosaveDelay) => void;
  setShowHiddenFiles: (show: boolean) => void;
  setTrimTrailingWhitespace: (enabled: boolean) => void;
  setInsertFinalNewline: (enabled: boolean) => void;
  setDefaultLineEnding: (ending: LineEnding) => void;
  setExcludePatterns: (patterns: string) => void;

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

      setInsertSpaces: (enabled) =>
        set((s) => {
          s.editor.insertSpaces = enabled;
        }),

      setEditorCursorStyle: (style) =>
        set((s) => {
          s.editor.cursorStyle = style;
        }),

      setRenderWhitespace: (mode) =>
        set((s) => {
          s.editor.renderWhitespace = mode;
        }),

      setFontLigatures: (enabled) =>
        set((s) => {
          s.editor.fontLigatures = enabled;
        }),

      setSmoothScrolling: (enabled) =>
        set((s) => {
          s.editor.smoothScrolling = enabled;
        }),

      // Terminal actions
      setTerminalFontFamily: (family) =>
        set((s) => {
          s.terminal.fontFamily = family;
        }),

      setTerminalFontSize: (size) =>
        set((s) => {
          s.terminal.fontSize = Math.max(10, Math.min(24, size));
        }),

      setTerminalScrollback: (lines) =>
        set((s) => {
          s.terminal.scrollback = Math.max(1000, Math.min(50000, lines));
        }),

      setTerminalCursorStyle: (style) =>
        set((s) => {
          s.terminal.cursorStyle = style;
        }),

      setTerminalShell: (shell) =>
        set((s) => {
          s.terminal.shell = shell;
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

      setTrimTrailingWhitespace: (enabled) =>
        set((s) => {
          s.files.trimTrailingWhitespace = enabled;
        }),

      setInsertFinalNewline: (enabled) =>
        set((s) => {
          s.files.insertFinalNewline = enabled;
        }),

      setDefaultLineEnding: (ending) =>
        set((s) => {
          s.files.defaultLineEnding = ending;
        }),

      setExcludePatterns: (patterns) =>
        set((s) => {
          s.files.excludePatterns = patterns;
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
      version: 3,
      storage: createJSONStorage(() => localStorage),
      migrate: (persistedState, version) => {
        if (version === 1) {
          return migrateV1ToV2(persistedState);
        }
        if (version === 2) {
          // v2 → v3: Add terminal, expanded editor, expanded files settings
          const v2 = persistedState as Partial<SettingsState>;
          return {
            ...DEFAULT_SETTINGS,
            general: { ...DEFAULT_SETTINGS.general, ...v2.general },
            editor: { ...DEFAULT_SETTINGS.editor, ...v2.editor },
            files: { ...DEFAULT_SETTINGS.files, ...v2.files },
            shortcuts: v2.shortcuts ?? DEFAULT_SETTINGS.shortcuts,
            ai: { ...DEFAULT_SETTINGS.ai, ...v2.ai },
          };
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

// Terminal selectors
export const useTerminalFontFamily = () => useSettingsStore((s) => s.terminal.fontFamily);
export const useTerminalFontSize = () => useSettingsStore((s) => s.terminal.fontSize);
export const useTerminalScrollback = () => useSettingsStore((s) => s.terminal.scrollback);
export const useTerminalCursorStyle = () => useSettingsStore((s) => s.terminal.cursorStyle);
export const useTerminalShell = () => useSettingsStore((s) => s.terminal.shell);
