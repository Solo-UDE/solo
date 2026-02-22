/**
 * FileViewerPanel - Panel implementation for viewing/editing file contents
 * Uses Monaco Editor for syntax highlighting and editing
 * Includes markdown preview support
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Editor, { OnMount, BeforeMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { WarningCircle, CaretRight } from '@phosphor-icons/react';
import { FileIcon } from '@react-symbols/icons/utils';
import { CodeSkeleton } from '@/components/ui/skeletons';
import * as fs from '@/lib/tauri/fs';
import { registerSoloTheme, SOLO_THEME_NAME, SOLO_LIGHT_THEME_NAME, registerSoloLightTheme } from '@/components/editor/theme';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { MarkdownToggle } from '@/components/editor/MarkdownToggle';
import { useSettingsStore } from '@/stores/settingsStore';
import { useFileExplorerStore } from '@/stores/fileExplorerStore';
import { useUIStore } from '@/stores/uiStore';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { PanelProps } from '@/lib/panels/types';
import type { MarkdownMode } from '@/stores/editorStore';

interface FileViewerData {
  filePath: string;
  fileName?: string;
}

/**
 * Check if file is a markdown file
 */
function isMarkdownFile(path: string | undefined): boolean {
  if (!path) return false;
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return ext === 'md' || ext === 'markdown';
}

interface BreadcrumbSegment {
  label: string;
  fullPath: string;
  isLast: boolean;
}

function buildBreadcrumbSegments(filePath: string, rootPath: string | null): BreadcrumbSegment[] {
  let displayPath = filePath;
  if (rootPath && filePath.startsWith(rootPath)) {
    displayPath = filePath.slice(rootPath.length).replace(/^\//, '');
  }
  const parts = displayPath.split('/').filter(Boolean);
  const segments: BreadcrumbSegment[] = [];
  let currentPath = rootPath ?? '';
  for (let i = 0; i < parts.length; i++) {
    currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
    segments.push({ label: parts[i], fullPath: currentPath, isLast: i === parts.length - 1 });
  }
  return segments;
}

/**
 * Get Monaco language ID from file extension
 */
function getMonacoLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';

  const langMap: Record<string, string> = {
    // TypeScript/JavaScript
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    // Systems languages
    rs: 'rust',
    go: 'go',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    // Scripting
    py: 'python',
    pyw: 'python',
    pyi: 'python',
    java: 'java',
    // Config files
    json: 'json',
    jsonc: 'json',
    toml: 'ini',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    lock: 'ini', // Cargo.lock, package-lock.json, etc.
    // Web
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    // Documentation
    md: 'markdown',
    markdown: 'markdown',
    // Shell
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    // Database
    sql: 'sql',
    // Dotfiles and config
    gitignore: 'ini',
    gitattributes: 'ini',
    dockerignore: 'ini',
    editorconfig: 'ini',
    env: 'shell',
    // Other
    makefile: 'makefile',
    dockerfile: 'dockerfile',
  };

  // Handle special filenames (without extension)
  const fileName = path.split('/').pop()?.toLowerCase() ?? '';
  if (fileName === 'dockerfile') return 'dockerfile';
  if (fileName === 'makefile') return 'makefile';
  if (fileName.startsWith('.env')) return 'shell';

  return langMap[ext] ?? 'plaintext';
}

export function FileViewerPanel({
  data,
  onTitleChange,
  onDirtyChange,
  onSaveCallbackChange,
}: PanelProps<FileViewerData>) {
  const [content, setContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileTooLarge, setFileTooLarge] = useState<{ size: number } | null>(null);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, col: 1 });

  // Markdown mode state — defaults to 'preview' for markdown files
  const [markdownMode, setMarkdownMode] = useState<MarkdownMode>('preview');

  // Refs for stable callbacks (A1: fix stale closure)
  const saveFileRef = useRef<() => Promise<void>>(async () => {});
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);

  // View state cache for cursor/scroll restoration (A5)
  const viewStateRef = useRef<Monaco.editor.ICodeEditorViewState | null>(null);

  const filePath = data?.filePath;
  const fileName = data?.fileName ?? (filePath ? filePath.split('/').pop() : undefined) ?? 'Untitled';

  // Settings from store (A4)
  const editorFontFamily = useSettingsStore((s) => s.general.editorFontFamily);
  const editorFontSize = useSettingsStore((s) => s.general.editorFontSize);
  const tabSize = useSettingsStore((s) => s.editor.tabSize);
  const wordWrap = useSettingsStore((s) => s.editor.wordWrap);
  const minimap = useSettingsStore((s) => s.editor.minimap);
  const lineNumbers = useSettingsStore((s) => s.editor.lineNumbers);
  const bracketColorization = useSettingsStore((s) => s.editor.bracketColorization);
  const insertSpaces = useSettingsStore((s) => s.editor.insertSpaces);
  const cursorStyle = useSettingsStore((s) => s.editor.cursorStyle);
  const renderWhitespace = useSettingsStore((s) => s.editor.renderWhitespace);
  const fontLigatures = useSettingsStore((s) => s.editor.fontLigatures);
  const smoothScrolling = useSettingsStore((s) => s.editor.smoothScrolling);

  // Theme (A8)
  const resolvedTheme = useColorScheme();
  const isDarkTheme = resolvedTheme === 'dark';
  const editorTheme = isDarkTheme ? SOLO_THEME_NAME : SOLO_LIGHT_THEME_NAME;

  // Check if current file is markdown
  const isMarkdown = useMemo(() => isMarkdownFile(filePath), [filePath]);

  // Breadcrumb navigation
  const rootPath = useFileExplorerStore((s) => s.rootPath);
  const expandDirectory = useFileExplorerStore((s) => s.expandDirectory);
  const selectFile = useFileExplorerStore((s) => s.selectFile);
  const setActiveTab = useUIStore((s) => s.setActiveTab);

  const breadcrumbSegments = useMemo(
    () => (filePath ? buildBreadcrumbSegments(filePath, rootPath) : []),
    [filePath, rootPath]
  );

  const handleBreadcrumbClick = useCallback(
    async (segment: BreadcrumbSegment) => {
      if (segment.isLast) return;
      setActiveTab('explorer');
      await expandDirectory(segment.fullPath);
      selectFile(segment.fullPath);
    },
    [setActiveTab, expandDirectory, selectFile]
  );

  // Update title based on file name
  useEffect(() => {
    onTitleChange(fileName);
  }, [fileName, onTitleChange]);

  // Load file content (A9: large file / binary detection)
  useEffect(() => {
    if (!filePath) {
      setContent('');
      setOriginalContent('');
      setError('No file path provided');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setFileTooLarge(null);

    fs.readFile(filePath)
      .then((response) => {
        if (cancelled) return;
        // Check for binary content (null bytes in first 8KB)
        const sample = response.content.slice(0, 8192);
        if (sample.includes('\0')) {
          setError('Binary file cannot be displayed');
          setContent('');
          setLoading(false);
          return;
        }
        // Check file size (>5MB)
        if (response.content.length > 5 * 1024 * 1024) {
          setFileTooLarge({ size: response.content.length });
          setContent('');
          setLoading(false);
          return;
        }
        setContent(response.content);
        setOriginalContent(response.content);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Failed to read file:', err);
        setError(err?.message ?? String(err));
        setContent('');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  // Track dirty state
  useEffect(() => {
    const isDirty = content !== originalContent;
    onDirtyChange(isDirty);
  }, [content, originalContent, onDirtyChange]);

  // Save file function
  const saveFile = useCallback(async () => {
    if (!filePath) return;

    try {
      await fs.writeFile(filePath, content);
      setOriginalContent(content);
    } catch (err) {
      console.error('Failed to save file:', err);
    }
  }, [filePath, content]);

  // A1: Keep saveFileRef always pointing to the latest saveFile
  useEffect(() => {
    saveFileRef.current = saveFile;
  }, [saveFile]);

  // A3: Register save callback with panel system for autosave
  useEffect(() => {
    onSaveCallbackChange?.(() => saveFileRef.current());
    return () => onSaveCallbackChange?.(undefined);
  }, [onSaveCallbackChange]);

  // Handle before mount (register both themes)
  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    registerSoloTheme(monaco);
    registerSoloLightTheme(monaco);
  }, []);

  // Handle editor mount (A1: use ref instead of direct saveFile)
  const handleEditorMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;

      // Add save command — calls through ref to avoid stale closure
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        saveFileRef.current();
      });

      // Track cursor position changes
      editor.onDidChangeCursorPosition((e) => {
        setCursorPosition({
          line: e.position.lineNumber,
          col: e.position.column,
        });
      });

      // A5: Restore saved view state
      if (viewStateRef.current) {
        editor.restoreViewState(viewStateRef.current);
      }

      // A5: Save view state when editor loses focus
      editor.onDidBlurEditorWidget(() => {
        viewStateRef.current = editor.saveViewState();
      });
    },
    []
  );

  // Handle content changes
  const handleEditorChange = useCallback((value: string | undefined) => {
    if (value !== undefined) {
      setContent(value);
    }
  }, []);

  // A4: Update Monaco options when settings change
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    editor.updateOptions({
      fontSize: editorFontSize,
      lineHeight: Math.round(editorFontSize * 1.7),
      fontFamily: editorFontFamily,
      minimap: { enabled: minimap },
      bracketPairColorization: { enabled: bracketColorization },
      lineNumbers,
      tabSize,
      wordWrap: wordWrap ? 'on' : 'off',
      insertSpaces,
      cursorStyle,
      renderWhitespace,
      fontLigatures,
      smoothScrolling,
    });
  }, [editorFontSize, editorFontFamily, minimap, bracketColorization, lineNumbers, tabSize, wordWrap, insertSpaces, cursorStyle, renderWhitespace, fontLigatures, smoothScrolling]);

  // Global keyboard shortcut for save (backup in case editor doesn't have focus)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        saveFileRef.current();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSetMarkdownMode = useCallback((mode: MarkdownMode) => {
    setMarkdownMode(mode);
  }, []);

  if (loading) {
    return (
      <div className="h-full bg-background">
        <CodeSkeleton lines={16} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="text-center space-y-4 max-w-md px-4">
          <WarningCircle className="w-8 h-8 text-destructive mx-auto" />
          <p className="text-sm text-destructive">Failed to load file</p>
          <p className="text-xs text-muted-foreground break-all">{error}</p>
        </div>
      </div>
    );
  }

  // A9: Large file warning
  if (fileTooLarge) {
    const sizeMB = (fileTooLarge.size / (1024 * 1024)).toFixed(1);
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="text-center space-y-4 max-w-md px-4">
          <WarningCircle className="w-8 h-8 text-muted-foreground mx-auto" />
          <p className="text-sm text-foreground">File too large to open</p>
          <p className="text-xs text-muted-foreground">
            This file is {sizeMB} MB. Files larger than 5 MB are not supported in the editor.
          </p>
        </div>
      </div>
    );
  }

  const language = filePath ? getMonacoLanguage(filePath) : 'plaintext';
  const lineCount = content.split('\n').length;

  // Font family (already includes fallback chain from settings)
  const resolvedFontFamily = editorFontFamily;

  // Monaco editor component
  const monacoEditor = (
    <Editor
      className="monaco-mount"
      height="100%"
      language={language}
      value={content}
      theme={editorTheme}
      beforeMount={handleBeforeMount}
      onMount={handleEditorMount}
      onChange={handleEditorChange}
      options={{
        fontSize: editorFontSize,
        lineHeight: Math.round(editorFontSize * 1.7),
        fontFamily: resolvedFontFamily,
        minimap: { enabled: minimap },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        bracketPairColorization: { enabled: bracketColorization },
        folding: true,
        lineNumbers,
        renderLineHighlight: 'line',
        cursorBlinking: 'smooth',
        cursorStyle,
        smoothScrolling,
        tabSize,
        insertSpaces,
        wordWrap: wordWrap ? 'on' : 'off',
        renderWhitespace,
        fontLigatures,
        padding: { top: 8, bottom: 8 },
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
    <div className="flex flex-col h-full bg-background">
      {/* Interactive breadcrumb with markdown toggle */}
      <div className="flex items-center justify-between h-6 px-3 bg-background/40 backdrop-blur-md border-b border-white/[0.04] shrink-0">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none flex-1 min-w-0">
          {breadcrumbSegments.length > 0 && (
            <FileIcon
              fileName={breadcrumbSegments[breadcrumbSegments.length - 1].label}
              autoAssign
              className="w-3.5 h-3.5 shrink-0"
            />
          )}
          {breadcrumbSegments.map((segment, i) => (
            <div key={segment.fullPath} className="flex items-center gap-1 shrink-0">
              {i > 0 && (
                <CaretRight className="w-2.5 h-2.5 text-muted-foreground/40 shrink-0" weight="bold" />
              )}
              {segment.isLast ? (
                <span className="text-xs text-foreground/80 font-medium whitespace-nowrap">
                  {segment.label}
                </span>
              ) : (
                <button
                  className="text-xs text-muted-foreground/60 hover:text-foreground transition-colors duration-100 whitespace-nowrap"
                  onClick={() => handleBreadcrumbClick(segment)}
                >
                  {segment.label}
                </button>
              )}
            </div>
          ))}
        </div>
        {isMarkdown && (
          <MarkdownToggle
            mode={markdownMode}
            onModeChange={handleSetMarkdownMode}
          />
        )}
      </div>

      {/* Editor content */}
      <div className="flex-1 overflow-hidden">
        {isMarkdown && markdownMode === 'preview' ? (
          <MarkdownEditor
            key={filePath}
            content={content}
            onContentChange={(md) => setContent(md)}
          />
        ) : (
          monacoEditor
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between h-6 px-3 bg-background/30 backdrop-blur-md text-muted-foreground text-xs border-t border-white/[0.04] shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0" />
            <span>{language}</span>
          </div>
          <span className="text-muted-foreground/60">UTF-8</span>
        </div>
        <div className="flex items-center gap-3 text-muted-foreground/60">
          <span>Ln {cursorPosition.line}, Col {cursorPosition.col}</span>
          <span>{lineCount} lines</span>
        </div>
      </div>
    </div>
  );
}
