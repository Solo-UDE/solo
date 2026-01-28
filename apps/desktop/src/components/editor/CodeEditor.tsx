/**
 * CodeEditor - Monaco Editor based code editor
 * Full-featured editor with syntax highlighting and editing capabilities
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Editor, { OnMount, BeforeMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { FileText, Loader2, AlertCircle } from 'lucide-react';
import * as fs from '../../lib/tauri/fs';
import { useEditorStore, isMarkdownFile, useMarkdownPreview } from '../../stores/editorStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useShallow } from 'zustand/react/shallow';
import { useParseResults, getSymbolPath } from '../../hooks/useParseResults';
import { useSyncedScroll } from '../../hooks/useSyncedScroll';
import { useSyncedSelection } from '../../hooks/useSyncedSelection';
import { EditorTabs } from './EditorTabs';
import { Breadcrumbs } from './Breadcrumbs';
import { MarkdownPreview } from './MarkdownPreview';
import { MarkdownSplitPane } from './MarkdownSplitPane';
import { MarkdownToggle } from './MarkdownToggle';
import { registerSoloTheme, SOLO_THEME_NAME } from './theme';
import type { Symbol } from '../../lib/tauri/parse';

interface CodeEditorProps {
  filePath: string | null;
  className?: string;
}

const DEFAULT_CURSOR_POSITION = { line: 1, col: 1 };

/**
 * Get Monaco language ID from file extension
 */
function getMonacoLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';

  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    rs: 'rust',
    py: 'python',
    pyw: 'python',
    pyi: 'python',
    json: 'json',
    jsonc: 'json',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    md: 'markdown',
    markdown: 'markdown',
    toml: 'ini',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
  };

  return langMap[ext] ?? 'plaintext';
}

export function CodeEditor({ filePath, className = '' }: CodeEditorProps) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  // Track editor instance for synced scroll/selection hooks (state triggers re-render when Monaco mounts)
  const [editorInstance, setEditorInstance] = useState<Monaco.editor.IStandaloneCodeEditor | null>(null);
  // Track when preview element is mounted (for ref timing in hooks)
  const [previewElement, setPreviewElement] = useState<HTMLDivElement | null>(null);

  // Callback ref that updates both the ref and state
  const previewRefCallback = useCallback((node: HTMLDivElement | null) => {
    previewRef.current = node;
    setPreviewElement(node);
  }, []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Store state (reactive) - use specific selectors to avoid Map reference issues
  const activeTab = useEditorStore((s) => s.activeTab);

  // Keep a ref to activeTab for use in Monaco callbacks (avoids stale closures)
  const activeTabRef = useRef(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  // Get current tab content with a stable selector
  const currentTabContent = useEditorStore((s) => {
    if (!s.activeTab) return '';
    return s.tabs.get(s.activeTab)?.currentContent ?? '';
  });

  // Get cursor position from store for breadcrumbs (useShallow for stable reference)
  const cursorPosition = useEditorStore(
    useShallow((s) => {
      if (!s.activeTab) return DEFAULT_CURSOR_POSITION;
      return s.tabs.get(s.activeTab)?.cursorPosition ?? DEFAULT_CURSOR_POSITION;
    })
  );

  // Check if a tab exists for the given path
  const hasTab = useEditorStore((s) => (filePath ? s.tabs.has(filePath) : false));

  // Editor settings from settings store
  const editorSettings = useSettingsStore(
    useShallow((s) => ({
      fontSize: s.general.editorFontSize,
      fontFamily: s.general.editorFontFamily,
      tabSize: s.editor.tabSize,
      wordWrap: s.editor.wordWrap,
      minimap: s.editor.minimap,
      lineNumbers: s.editor.lineNumbers,
      bracketColorization: s.editor.bracketColorization,
    }))
  );

  // Store actions via ref to avoid re-render loops
  const storeRef = useRef(useEditorStore.getState());
  useEffect(() => {
    storeRef.current = useEditorStore.getState();
  });

  // Parse results for symbol outline and breadcrumbs
  const parseResults = useParseResults(activeTab, currentTabContent || undefined);

  // Get symbol path for breadcrumbs based on cursor position
  const symbolPath =
    parseResults.symbols.length > 0
      ? getSymbolPath(parseResults.symbols, cursorPosition.line - 1, cursorPosition.col - 1)
      : [];

  // Markdown preview state
  const isMarkdown = useMemo(() => isMarkdownFile(activeTab), [activeTab]);
  const { enabled: markdownPreviewEnabled, splitPosition } = useMarkdownPreview(activeTab);

  // Force word wrap when markdown preview is open (editor pane shrinks)
  const effectiveWordWrap = useMemo(() => {
    if (isMarkdown && markdownPreviewEnabled) {
      return true;
    }
    return editorSettings.wordWrap;
  }, [isMarkdown, markdownPreviewEnabled, editorSettings.wordWrap]);

  // Synchronized scrolling between editor and preview
  useSyncedScroll({
    editor: editorInstance,
    previewElement,
    enabled: isMarkdown && markdownPreviewEnabled,
  });

  // Sync selection from preview to editor
  useSyncedSelection({
    editor: editorInstance,
    previewElement,
    enabled: isMarkdown && markdownPreviewEnabled,
  });

  // Markdown preview handlers
  const handleToggleMarkdownPreview = useCallback(() => {
    if (activeTab) {
      storeRef.current.toggleMarkdownPreview(activeTab);
    }
  }, [activeTab]);

  const handleSplitPositionChange = useCallback(
    (position: number) => {
      if (activeTab) {
        storeRef.current.setMarkdownSplitPosition(activeTab, position);
      }
    },
    [activeTab]
  );

  // Navigate to a symbol's location in the editor
  const navigateToSymbol = useCallback((symbol: Symbol) => {
    const editor = editorRef.current;
    if (!editor) return;

    const position = {
      lineNumber: symbol.selection_range.start_line + 1,
      column: symbol.selection_range.start_col + 1,
    };

    editor.setPosition(position);
    editor.revealPositionInCenter(position);
    editor.focus();
  }, []);

  // Save file function
  const saveFile = useCallback(async (path: string) => {
    const tab = storeRef.current.tabs.get(path);
    if (!tab) return;

    try {
      await fs.writeFile(path, tab.currentContent);
      storeRef.current.markSaved(path);
    } catch (err) {
      console.error('Failed to save file:', err);
    }
  }, []);

  // Handle editor mount
  const handleEditorMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;
      setEditorInstance(editor);

      // Add save command (Cmd+S / Ctrl+S) - use ref to avoid stale closure
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        const currentTab = activeTabRef.current;
        if (currentTab) {
          saveFile(currentTab);
        }
      });

      // Track cursor position changes - use ref to avoid stale closure
      editor.onDidChangeCursorPosition((e) => {
        const currentTab = activeTabRef.current;
        if (currentTab) {
          storeRef.current.updateCursorPosition(
            currentTab,
            e.position.lineNumber,
            e.position.column
          );
        }
      });
    },
    [saveFile]
  );

  // Handle before mount (register theme)
  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    registerSoloTheme(monaco);
  }, []);

  // Handle content changes
  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (activeTab && value !== undefined) {
        storeRef.current.updateContent(activeTab, value);
        // Update line count
        const lineCount = value.split('\n').length;
        storeRef.current.updateLineCount(activeTab, lineCount);
      }
    },
    [activeTab]
  );

  // Load file when filePath changes
  useEffect(() => {
    if (!filePath) {
      setError(null);
      return;
    }

    let cancelled = false;

    async function loadFile() {
      // Check if tab already exists with content
      if (hasTab) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fs.readFile(filePath!);

        if (cancelled) return;

        // Open tab with content
        storeRef.current.openTab(filePath!, response.content);
        storeRef.current.updateLineCount(filePath!, response.content.split('\n').length);
        storeRef.current.updateCursorPosition(filePath!, 1, 1);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load file:', err);
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    }

    loadFile();

    return () => {
      cancelled = true;
    };
  }, [filePath, hasTab]);

  // Global keyboard shortcut for save (backup in case editor doesn't have focus)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (activeTab) {
          saveFile(activeTab);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, saveFile]);

  // Update Monaco options when settings change
  useEffect(() => {
    if (!editorInstance) return;

    editorInstance.updateOptions({
      fontSize: editorSettings.fontSize,
      lineHeight: Math.round(editorSettings.fontSize * 1.7),
      fontFamily: editorSettings.fontFamily === 'system-ui'
        ? 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace'
        : `${editorSettings.fontFamily}, ui-monospace, monospace`,
      minimap: { enabled: editorSettings.minimap },
      bracketPairColorization: { enabled: editorSettings.bracketColorization },
      lineNumbers: editorSettings.lineNumbers,
      tabSize: editorSettings.tabSize,
      wordWrap: effectiveWordWrap ? 'on' : 'off',
    });
  }, [editorSettings, effectiveWordWrap, editorInstance]);

  // No file selected - show placeholder
  if (!filePath && !activeTab) {
    return (
      <div className={`flex flex-col h-full bg-background ${className}`}>
        <EditorTabs />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <FileText className="w-12 h-12 text-muted-foreground/50 mx-auto" />
            <p className="text-muted-foreground">Select a file from the explorer to view it</p>
            <p className="text-xs text-muted-foreground/60">Double-click a file or press Enter</p>
          </div>
        </div>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className={`flex flex-col h-full bg-background ${className}`}>
        <EditorTabs />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto" />
            <p className="text-sm text-muted-foreground">Loading file...</p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={`flex flex-col h-full bg-background ${className}`}>
        <EditorTabs />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4 max-w-md px-4">
            <AlertCircle className="w-8 h-8 text-destructive mx-auto" />
            <p className="text-sm text-destructive">Failed to load file</p>
            <p className="text-xs text-muted-foreground break-all">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  const monacoEditor = (
    <Editor
      height="100%"
      language={activeTab ? getMonacoLanguage(activeTab) : 'plaintext'}
      value={currentTabContent}
      theme={SOLO_THEME_NAME}
      beforeMount={handleBeforeMount}
      onMount={handleEditorMount}
      onChange={handleEditorChange}
      options={{
        fontSize: editorSettings.fontSize,
        lineHeight: Math.round(editorSettings.fontSize * 1.7),
        fontFamily: editorSettings.fontFamily === 'system-ui'
          ? 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace'
          : `${editorSettings.fontFamily}, ui-monospace, monospace`,
        minimap: { enabled: editorSettings.minimap },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        bracketPairColorization: { enabled: editorSettings.bracketColorization },
        folding: true,
        lineNumbers: editorSettings.lineNumbers,
        renderLineHighlight: 'line',
        cursorBlinking: 'smooth',
        smoothScrolling: true,
        tabSize: editorSettings.tabSize,
        insertSpaces: true,
        wordWrap: effectiveWordWrap ? 'on' : 'off',
        padding: { top: 0, bottom: 0 },
        scrollbar: {
          useShadows: false,
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
        },
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        overviewRulerBorder: false,
      }}
    />
  );

  return (
    <div className={`flex flex-col h-full bg-background ${className}`}>
      {/* Tab bar */}
      <EditorTabs />

      {/* Breadcrumb with symbol path and markdown toggle */}
      <Breadcrumbs
        filePath={filePath ?? activeTab}
        symbolPath={symbolPath}
        onSymbolClick={navigateToSymbol}
        rightContent={
          isMarkdown ? (
            <MarkdownToggle enabled={markdownPreviewEnabled} onToggle={handleToggleMarkdownPreview} />
          ) : null
        }
      />

      {/* Editor content - use split pane for markdown files to keep editor in stable tree position */}
      <div className="flex-1 overflow-hidden">
        {isMarkdown ? (
          <MarkdownSplitPane
            left={monacoEditor}
            right={<MarkdownPreview ref={previewRefCallback} content={currentTabContent} />}
            splitPosition={markdownPreviewEnabled ? splitPosition : 100}
            onSplitChange={handleSplitPositionChange}
            isOpen={markdownPreviewEnabled}
          />
        ) : (
          monacoEditor
        )}
      </div>
    </div>
  );
}
