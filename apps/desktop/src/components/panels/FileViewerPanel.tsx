/**
 * FileViewerPanel - Panel implementation for viewing/editing file contents
 * Uses Monaco Editor for syntax highlighting and editing
 * Includes markdown preview support
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import Editor, { OnMount, BeforeMount } from '@monaco-editor/react';
import { CircleNotch, WarningCircle } from '@phosphor-icons/react';
import * as fs from '@/lib/tauri/fs';
import { registerSoloTheme, SOLO_THEME_NAME } from '@/components/editor/theme';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { MarkdownToggle } from '@/components/editor/MarkdownToggle';
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
}: PanelProps<FileViewerData>) {
  const [content, setContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, col: 1 });

  // Markdown mode state — defaults to 'preview' for markdown files
  const [markdownMode, setMarkdownMode] = useState<MarkdownMode>('preview');

  const filePath = data?.filePath;
  const fileName = data?.fileName ?? (filePath ? filePath.split('/').pop() : undefined) ?? 'Untitled';

  // Check if current file is markdown
  const isMarkdown = useMemo(() => isMarkdownFile(filePath), [filePath]);

  // Update title based on file name
  useEffect(() => {
    onTitleChange(fileName);
  }, [fileName, onTitleChange]);

  // Load file content
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

    fs.readFile(filePath)
      .then((response) => {
        if (cancelled) return;
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

  // Handle before mount (register theme)
  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    registerSoloTheme(monaco);
  }, []);

  // Handle editor mount
  const handleEditorMount: OnMount = useCallback(
    (editor, monaco) => {
      // Add save command (Cmd+S / Ctrl+S)
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        saveFile();
      });

      // Track cursor position changes
      editor.onDidChangeCursorPosition((e) => {
        setCursorPosition({
          line: e.position.lineNumber,
          col: e.position.column,
        });
      });
    },
    [saveFile]
  );

  // Handle content changes
  const handleEditorChange = useCallback((value: string | undefined) => {
    if (value !== undefined) {
      setContent(value);
    }
  }, []);

  // Global keyboard shortcut for save (backup in case editor doesn't have focus)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        saveFile();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveFile]);

  const handleSetMarkdownMode = useCallback((mode: MarkdownMode) => {
    setMarkdownMode(mode);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="text-center space-y-4">
          <CircleNotch weight="bold" className="w-8 h-8 text-primary animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Loading file...</p>
        </div>
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

  const language = filePath ? getMonacoLanguage(filePath) : 'plaintext';
  const lineCount = content.split('\n').length;

  // Monaco editor component
  const monacoEditor = (
    <Editor
      className="monaco-mount"
      height="100%"
      language={language}
      value={content}
      theme={SOLO_THEME_NAME}
      beforeMount={handleBeforeMount}
      onMount={handleEditorMount}
      onChange={handleEditorChange}
      options={{
        fontSize: 13,
        lineHeight: 22,
        fontFamily: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true,
        bracketPairColorization: { enabled: true },
        folding: true,
        lineNumbers: 'on',
        renderLineHighlight: 'line',
        cursorBlinking: 'smooth',
        smoothScrolling: true,
        tabSize: 2,
        insertSpaces: true,
        wordWrap: 'off',
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
      {/* Breadcrumb with markdown toggle */}
      <div className="flex items-center justify-between h-6 px-3 bg-muted/30 border-b border-border/30 shrink-0">
        <span className="text-[11px] text-muted-foreground truncate flex-1">{filePath}</span>
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
      <div className="flex items-center justify-between h-6 px-3 bg-primary text-primary-foreground text-[12px] shrink-0">
        <div className="flex items-center gap-4">
          <span>{language}</span>
          <span>UTF-8</span>
        </div>
        <div className="flex items-center gap-4">
          <span>Ln {cursorPosition.line}, Col {cursorPosition.col}</span>
          <span>{lineCount} lines</span>
        </div>
      </div>
    </div>
  );
}
