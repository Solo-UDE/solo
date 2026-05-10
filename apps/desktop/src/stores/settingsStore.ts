/**
 * Settings Store - Manages user preferences with persistence
 * Grouped by category: general, editor, files, shortcuts, ai
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { ShortcutsConfig } from '@/bindings/ShortcutsConfig';

// Type definitions
export type ColorScheme = 'system' | 'light' | 'dark';
export type AutosaveDelay = 0 | 5000 | 10000 | 30000 | 'disabled';
export type LineNumbers = 'on' | 'off' | 'relative';
export type TabSize = 2 | 4 | 8;
export type CursorStyle = 'line' | 'block' | 'underline';
export type RenderWhitespace = 'none' | 'boundary' | 'all';
export type LineEnding = 'lf' | 'crlf' | 'auto';
export type ToolPermissionPolicy = 'ask-all' | 'smart' | 'approve-all';
export type ThemeSurface = 'light' | 'dark';
export type ThemePresetId = 'solo' | 'watermelon' | 'custom';
type ThemePresetOptionId = Exclude<ThemePresetId, 'custom'>;

export interface ThemePalette {
  accent: string;
  background: string;
  foreground: string;
  uiFontFamily: string;
  codeFontFamily: string;
  translucentSidebar: boolean;
  contrast: number;
  fontSmoothing: boolean;
}

export interface AppearanceSettings {
  activePreset: ThemePresetId;
  light: ThemePalette;
  dark: ThemePalette;
}

const DEFAULT_UI_FONT = '"Inter Variable", Inter, ui-sans-serif, system-ui, sans-serif';
const DEFAULT_CODE_FONT = '"SF Mono", SFMono-Regular, ui-monospace, monospace';
const GEIST_CODE_FONT = '"Geist Mono Variable", "SF Mono", ui-monospace, monospace';

export const UI_FONT_FAMILIES = [
  { label: 'Inter', value: DEFAULT_UI_FONT },
  { label: 'System', value: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif' },
  { label: 'Geist', value: '"Geist Variable", Geist, ui-sans-serif, system-ui, sans-serif' },
  { label: 'Atkinson', value: '"Atkinson Hyperlegible Next Variable", ui-sans-serif, system-ui, sans-serif' },
] as const;

export const FONT_FAMILIES = [
  { label: 'SF Mono', value: DEFAULT_CODE_FONT },
  { label: 'Geist Mono', value: GEIST_CODE_FONT },
  { label: 'Menlo', value: 'Menlo, Monaco, ui-monospace, monospace' },
  { label: 'System Default', value: 'ui-monospace, system-ui, monospace' },
] as const;

export const APPEARANCE_PRESETS: Record<ThemePresetOptionId, {
  label: string;
  light: ThemePalette;
  dark: ThemePalette;
}> = {
  solo: {
    label: 'Solo',
    light: {
      accent: '#2f8f68',
      background: '#f6f4ef',
      foreground: '#22201d',
      uiFontFamily: DEFAULT_UI_FONT,
      codeFontFamily: DEFAULT_CODE_FONT,
      translucentSidebar: true,
      contrast: 58,
      fontSmoothing: true,
    },
    dark: {
      accent: '#7ccfa8',
      background: '#171915',
      foreground: '#f2f0e8',
      uiFontFamily: DEFAULT_UI_FONT,
      codeFontFamily: DEFAULT_CODE_FONT,
      translucentSidebar: true,
      contrast: 64,
      fontSmoothing: true,
    },
  },
  watermelon: {
    label: 'Watermelon',
    light: {
      accent: '#ff4f2e',
      background: '#fff7f3',
      foreground: '#241714',
      uiFontFamily: DEFAULT_UI_FONT,
      codeFontFamily: GEIST_CODE_FONT,
      translucentSidebar: true,
      contrast: 54,
      fontSmoothing: true,
    },
    dark: {
      accent: '#ff633d',
      background: '#161311',
      foreground: '#fff8f3',
      uiFontFamily: DEFAULT_UI_FONT,
      codeFontFamily: GEIST_CODE_FONT,
      translucentSidebar: true,
      contrast: 64,
      fontSmoothing: true,
    },
  },
};

const clonePreset = (preset: ThemePresetOptionId): AppearanceSettings => ({
  activePreset: preset,
  light: { ...APPEARANCE_PRESETS[preset].light },
  dark: { ...APPEARANCE_PRESETS[preset].dark },
});

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
  /** Tool permission policy: 'ask-all' (prompt everything), 'smart' (tier-based), 'approve-all' (auto-approve everything) */
  toolPermissionPolicy: ToolPermissionPolicy;
  maxTokens: number;
  customApiUrl: string;
  /** Days to keep old sessions (0 = infinite). Default 30. */
  sessionRetentionDays: number;
}

interface SettingsState {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  editor: EditorSettings;
  terminal: TerminalSettings;
  files: FilesSettings;
  shortcuts: ShortcutsSettings;
  ai: AISettings;
  voiceShortcuts: ShortcutsConfig;
}

// Default values
const DEFAULT_SETTINGS: SettingsState = {
  general: {
    colorScheme: 'system',
    editorFontFamily: DEFAULT_CODE_FONT,
    editorFontSize: 13,
  },
  appearance: clonePreset('solo'),
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
    fontFamily: DEFAULT_CODE_FONT,
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
    toolPermissionPolicy: 'ask-all',
    maxTokens: 4096,
    customApiUrl: '',
    sessionRetentionDays: 30,
  },
  voiceShortcuts: {
    dictation_ptt: 'fn',
    dispatch_ptt: 'ctrl+alt+space',
    cancel: 'escape',
  },
};

interface SettingsActions {
  // General
  setColorScheme: (scheme: ColorScheme) => void;
  setEditorFontFamily: (family: string) => void;
  setEditorFontSize: (size: number) => void;
  setThemePalette: (surface: ThemeSurface, patch: Partial<ThemePalette>) => void;
  setAppearancePreset: (preset: Exclude<ThemePresetId, 'custom'>) => void;
  resetAppearance: () => void;

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
  setToolPermissionPolicy: (policy: ToolPermissionPolicy) => void;
  setMaxTokens: (tokens: number) => void;
  setCustomApiUrl: (url: string) => void;

  // Voice
  setVoiceShortcuts: (s: ShortcutsConfig) => void;

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

function mergeAppearance(
  current: AppearanceSettings,
  persisted?: Partial<AppearanceSettings>,
): AppearanceSettings {
  if ((persisted?.activePreset as string | undefined) === 'codex') {
    return clonePreset('solo');
  }

  return normalizeAppearanceFonts({
    activePreset: normalizeActivePreset(persisted?.activePreset ?? current.activePreset),
    light: { ...current.light, ...persisted?.light },
    dark: { ...current.dark, ...persisted?.dark },
  });
}

function normalizeActivePreset(preset: unknown): ThemePresetId {
  if (preset === 'custom') return 'custom';
  if (typeof preset === 'string' && preset in APPEARANCE_PRESETS) {
    return preset as ThemePresetOptionId;
  }
  return 'solo';
}

function normalizeAppearanceFonts(appearance: AppearanceSettings): AppearanceSettings {
  const oldSystemFont = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif';
  const oldWatermelonCodeFont = '"Geist Mono Variable", ' + DEFAULT_CODE_FONT;
  const normalizePalette = (palette: ThemePalette): ThemePalette => ({
    ...palette,
    uiFontFamily: palette.uiFontFamily === oldSystemFont ? DEFAULT_UI_FONT : palette.uiFontFamily,
    codeFontFamily: palette.codeFontFamily === oldWatermelonCodeFont ? GEIST_CODE_FONT : palette.codeFontFamily,
    contrast: Math.max(0, Math.min(100, palette.contrast)),
  });
  return {
    ...appearance,
    activePreset: normalizeActivePreset(appearance.activePreset),
    light: normalizePalette(appearance.light),
    dark: normalizePalette(appearance.dark),
  };
}

// Drop legacy elevenlabs keys on load (safe no-op if absent)
const raw = localStorage.getItem('solo-settings');
if (raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.state && 'elevenlabs' in parsed.state) {
      delete parsed.state.elevenlabs;
      localStorage.setItem('solo-settings', JSON.stringify(parsed));
    }
  } catch { /* ignore */ }
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

      setThemePalette: (surface, patch) =>
        set((s) => {
          Object.assign(s.appearance[surface], patch);
          s.appearance.activePreset = 'custom';
        }),

      setAppearancePreset: (preset) =>
        set((s) => {
          const next = clonePreset(preset);
          s.appearance.activePreset = next.activePreset;
          s.appearance.light = next.light;
          s.appearance.dark = next.dark;
        }),

      resetAppearance: () =>
        set((s) => {
          const next = clonePreset('solo');
          s.appearance.activePreset = next.activePreset;
          s.appearance.light = next.light;
          s.appearance.dark = next.dark;
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

      setToolPermissionPolicy: (policy) =>
        set((s) => {
          s.ai.toolPermissionPolicy = policy;
        }),

      setMaxTokens: (tokens) =>
        set((s) => {
          // Hard safety bounds; per-model ceiling is enforced at the UI layer
          // (slider max = active model's max_output_tokens) and server-side
          // by Claude Code's validateBoundedIntEnvVar against the model's upperLimit.
          s.ai.maxTokens = Math.max(1024, Math.min(200_000, tokens));
        }),

      setCustomApiUrl: (url) =>
        set((s) => {
          s.ai.customApiUrl = url;
        }),

      // Voice actions
      setVoiceShortcuts: (shortcuts) =>
        set((s) => {
          s.voiceShortcuts = shortcuts;
        }),

      // Global actions
      resetToDefaults: () =>
        set(() => ({ ...DEFAULT_SETTINGS })),
    })),
    {
      name: 'solo-settings',
      version: 6,
      storage: createJSONStorage(() => localStorage),
      // Deep-merge at category level so new fields (e.g. ai.toolPermissionPolicy)
      // aren't lost when persisted state predates their addition.
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<SettingsState>;
        return {
          ...currentState,
          general: { ...(currentState as SettingsStore).general, ...persisted.general },
          appearance: mergeAppearance(
            (currentState as SettingsStore).appearance,
            persisted.appearance,
          ),
          editor: { ...(currentState as SettingsStore).editor, ...persisted.editor },
          files: { ...(currentState as SettingsStore).files, ...persisted.files },
          shortcuts: persisted.shortcuts ?? (currentState as SettingsStore).shortcuts,
          ai: { ...(currentState as SettingsStore).ai, ...persisted.ai },
          terminal: { ...(currentState as SettingsStore).terminal, ...persisted.terminal },
          voiceShortcuts: persisted.voiceShortcuts ?? (currentState as SettingsStore).voiceShortcuts,
        } as SettingsStore;
      },
      migrate: (persistedState, version) => {
        if (version === 1) {
          return migrateV1ToV2(persistedState);
        }
        if (version === 2) {
          // v2 → v4: Add terminal, expanded editor/files settings, appearance controls
          const v2 = persistedState as Partial<SettingsState>;
          return {
            ...DEFAULT_SETTINGS,
            general: { ...DEFAULT_SETTINGS.general, ...v2.general },
            appearance: mergeAppearance(DEFAULT_SETTINGS.appearance, v2.appearance),
            editor: { ...DEFAULT_SETTINGS.editor, ...v2.editor },
            files: { ...DEFAULT_SETTINGS.files, ...v2.files },
            shortcuts: v2.shortcuts ?? DEFAULT_SETTINGS.shortcuts,
            ai: { ...DEFAULT_SETTINGS.ai, ...v2.ai },
            voiceShortcuts: v2.voiceShortcuts ?? DEFAULT_SETTINGS.voiceShortcuts,
          };
        }
        if (version === 3) {
          const v3 = persistedState as Partial<SettingsState>;
          return {
            ...DEFAULT_SETTINGS,
            general: { ...DEFAULT_SETTINGS.general, ...v3.general },
            appearance: mergeAppearance(DEFAULT_SETTINGS.appearance, v3.appearance),
            editor: { ...DEFAULT_SETTINGS.editor, ...v3.editor },
            files: { ...DEFAULT_SETTINGS.files, ...v3.files },
            shortcuts: v3.shortcuts ?? DEFAULT_SETTINGS.shortcuts,
            ai: { ...DEFAULT_SETTINGS.ai, ...v3.ai },
            terminal: { ...DEFAULT_SETTINGS.terminal, ...v3.terminal },
            voiceShortcuts: v3.voiceShortcuts ?? DEFAULT_SETTINGS.voiceShortcuts,
          };
        }
        if (version === 4) {
          const v4 = persistedState as Partial<SettingsState>;
          return {
            ...DEFAULT_SETTINGS,
            general: { ...DEFAULT_SETTINGS.general, ...v4.general },
            appearance: mergeAppearance(DEFAULT_SETTINGS.appearance, v4.appearance),
            editor: { ...DEFAULT_SETTINGS.editor, ...v4.editor },
            files: { ...DEFAULT_SETTINGS.files, ...v4.files },
            shortcuts: v4.shortcuts ?? DEFAULT_SETTINGS.shortcuts,
            ai: { ...DEFAULT_SETTINGS.ai, ...v4.ai },
            terminal: { ...DEFAULT_SETTINGS.terminal, ...v4.terminal },
            voiceShortcuts: v4.voiceShortcuts ?? DEFAULT_SETTINGS.voiceShortcuts,
          };
        }
        if (version === 5) {
          const v5 = persistedState as Partial<SettingsState>;
          return {
            ...DEFAULT_SETTINGS,
            general: { ...DEFAULT_SETTINGS.general, ...v5.general },
            appearance: mergeAppearance(DEFAULT_SETTINGS.appearance, v5.appearance),
            editor: { ...DEFAULT_SETTINGS.editor, ...v5.editor },
            files: { ...DEFAULT_SETTINGS.files, ...v5.files },
            shortcuts: v5.shortcuts ?? DEFAULT_SETTINGS.shortcuts,
            ai: { ...DEFAULT_SETTINGS.ai, ...v5.ai },
            terminal: { ...DEFAULT_SETTINGS.terminal, ...v5.terminal },
            voiceShortcuts: v5.voiceShortcuts ?? DEFAULT_SETTINGS.voiceShortcuts,
          };
        }
        return persistedState as SettingsState;
      },
    }
  )
);

// Convenience selectors
export const useColorScheme = () => useSettingsStore((s) => s.general.colorScheme);
export const useAppearanceSettings = () => useSettingsStore((s) => s.appearance);
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
export const useToolPermissionPolicy = () => useSettingsStore((s) => s.ai.toolPermissionPolicy);
export const useMaxTokens = () => useSettingsStore((s) => s.ai.maxTokens);
export const useCustomApiUrl = () => useSettingsStore((s) => s.ai.customApiUrl);

// Terminal selectors
export const useTerminalFontFamily = () => useSettingsStore((s) => s.terminal.fontFamily);
export const useTerminalFontSize = () => useSettingsStore((s) => s.terminal.fontSize);
export const useTerminalScrollback = () => useSettingsStore((s) => s.terminal.scrollback);
export const useTerminalCursorStyle = () => useSettingsStore((s) => s.terminal.cursorStyle);
export const useTerminalShell = () => useSettingsStore((s) => s.terminal.shell);
