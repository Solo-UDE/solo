/**
 * CodeEditor - CodeMirror 6 based code editor
 * Full-featured editor with syntax highlighting and editing capabilities
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { EditorState, Extension } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightSpecialChars,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import {
  autocompletion,
  completionKeymap,
  closeBrackets,
  closeBracketsKeymap,
} from '@codemirror/autocomplete';
import {
  bracketMatching,
  indentOnInput,
  foldGutter,
  foldKeymap,
} from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { rust } from '@codemirror/lang-rust';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';
import { FileText, Loader2, AlertCircle } from 'lucide-react';
import * as fs from '../../lib/tauri/fs';
import { useEditorStore, useIsTabDirty } from '../../stores/editorStore';
import { useParseResults, getSymbolPath } from '../../hooks/useParseResults';
import { EditorTabs } from './EditorTabs';
import { Breadcrumbs } from './Breadcrumbs';
import { soloTheme } from './theme';
import type { Symbol } from '../../lib/tauri/parse';

interface CodeEditorProps {
  filePath: string | null;
  className?: string;
}

type LanguageSupport = Extension;

/**
 * Get CodeMirror language support from file extension
 */
function getLanguageExtension(path: string): LanguageSupport | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';

  switch (ext) {
    case 'ts':
    case 'tsx':
      return javascript({ jsx: true, typescript: true });
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return javascript({ jsx: true });
    case 'rs':
      return rust();
    case 'py':
    case 'pyw':
    case 'pyi':
      return python();
    case 'json':
    case 'jsonc':
      return json();
    case 'html':
    case 'htm':
      return html();
    case 'css':
    case 'scss':
    case 'less':
      return css();
    case 'md':
    case 'markdown':
      return markdown();
    default:
      return null;
  }
}

/**
 * Get language display name from file extension
 */
function getLanguageName(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const langMap: Record<string, string> = {
    ts: 'TypeScript',
    tsx: 'TypeScript React',
    js: 'JavaScript',
    jsx: 'JavaScript React',
    mjs: 'JavaScript',
    cjs: 'JavaScript',
    rs: 'Rust',
    py: 'Python',
    pyw: 'Python',
    pyi: 'Python',
    json: 'JSON',
    jsonc: 'JSON with Comments',
    html: 'HTML',
    htm: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    less: 'Less',
    md: 'Markdown',
    markdown: 'Markdown',
    toml: 'TOML',
    yaml: 'YAML',
    yml: 'YAML',
    xml: 'XML',
    sql: 'SQL',
    sh: 'Shell',
    bash: 'Bash',
    zsh: 'Zsh',
  };
  return langMap[ext] ?? 'Plain Text';
}

export function CodeEditor({ filePath, className = '' }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, col: 1 });
  const [lineCount, setLineCount] = useState(0);
  const [saving, setSaving] = useState(false);

  // Store actions
  const openTab = useEditorStore((s) => s.openTab);
  const updateContent = useEditorStore((s) => s.updateContent);
  const markSaved = useEditorStore((s) => s.markSaved);
  const activeTab = useEditorStore((s) => s.activeTab);
  const tabs = useEditorStore((s) => s.tabs);

  const isDirty = useIsTabDirty(activeTab);

  // Get current content for parsing
  const currentContent = activeTab ? tabs.get(activeTab)?.currentContent : undefined;

  // Parse results for symbol outline and breadcrumbs
  const parseResults = useParseResults(activeTab, currentContent);

  // Get symbol path for breadcrumbs based on cursor position
  const symbolPath = parseResults.symbols.length > 0
    ? getSymbolPath(parseResults.symbols, cursorPosition.line - 1, cursorPosition.col - 1)
    : [];

  // Navigate to a symbol's location in the editor
  const navigateToSymbol = useCallback((symbol: Symbol) => {
    const view = editorViewRef.current;
    if (!view) return;

    // Get position from symbol's selection range (0-indexed)
    const line = symbol.selection_range.start_line + 1;
    const lineInfo = view.state.doc.line(line);
    const pos = lineInfo.from + symbol.selection_range.start_col;

    // Set selection and scroll into view
    view.dispatch({
      selection: { anchor: pos },
      scrollIntoView: true,
    });
    view.focus();
  }, []);

  // Save file function
  const saveFile = useCallback(
    async (path: string) => {
      const tab = tabs.get(path);
      if (!tab) return;

      setSaving(true);
      try {
        await fs.writeFile(path, tab.currentContent);
        markSaved(path);
      } catch (err) {
        console.error('Failed to save file:', err);
        // Could show error toast here
      } finally {
        setSaving(false);
      }
    },
    [tabs, markSaved]
  );

  // Build extensions for the editor
  const buildExtensions = useCallback(
    (path: string): Extension[] => {
      const extensions: Extension[] = [
        // Basic setup
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),

        // Keymaps including custom save command
        keymap.of([
          // Save command (Cmd+S / Ctrl+S)
          {
            key: 'Mod-s',
            run: () => {
              saveFile(path);
              return true;
            },
          },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),

        // Theme
        soloTheme,

        // Update listener for cursor position and content changes
        EditorView.updateListener.of((update) => {
          if (update.selectionSet) {
            const pos = update.state.selection.main.head;
            const line = update.state.doc.lineAt(pos);
            setCursorPosition({
              line: line.number,
              col: pos - line.from + 1,
            });
          }
          if (update.docChanged) {
            setLineCount(update.state.doc.lines);
            // Update store with new content
            const newContent = update.state.doc.toString();
            updateContent(path, newContent);
          }
        }),
      ];

      // Add language support if available
      const langExt = getLanguageExtension(path);
      if (langExt) {
        extensions.push(langExt);
      }

      return extensions;
    },
    [saveFile, updateContent]
  );

  // Load file and create editor
  useEffect(() => {
    if (!filePath || !containerRef.current) {
      // Cleanup existing editor
      if (editorViewRef.current) {
        editorViewRef.current.destroy();
        editorViewRef.current = null;
      }
      setError(null);
      setLineCount(0);
      setCursorPosition({ line: 1, col: 1 });
      return;
    }

    let cancelled = false;

    async function loadFile() {
      // Check if tab already exists with content
      const existingTab = tabs.get(filePath!);
      if (existingTab) {
        // Use cached content
        if (cancelled) return;

        // Destroy previous editor
        if (editorViewRef.current) {
          editorViewRef.current.destroy();
          editorViewRef.current = null;
        }

        // Create editor with cached content
        const state = EditorState.create({
          doc: existingTab.currentContent,
          extensions: buildExtensions(filePath!),
        });

        const view = new EditorView({
          state,
          parent: containerRef.current!,
        });

        editorViewRef.current = view;
        setLineCount(state.doc.lines);
        setCursorPosition(existingTab.cursorPosition ?? { line: 1, col: 1 });
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fs.readFile(filePath!);

        if (cancelled) return;

        // Open tab with content
        openTab(filePath!, response.content);

        // Destroy previous editor
        if (editorViewRef.current) {
          editorViewRef.current.destroy();
          editorViewRef.current = null;
        }

        // Create new editor state
        const state = EditorState.create({
          doc: response.content,
          extensions: buildExtensions(filePath!),
        });

        // Create editor view
        const view = new EditorView({
          state,
          parent: containerRef.current!,
        });

        editorViewRef.current = view;
        setLineCount(state.doc.lines);
        setCursorPosition({ line: 1, col: 1 });
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
  }, [filePath, tabs, openTab, buildExtensions]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (editorViewRef.current) {
        editorViewRef.current.destroy();
        editorViewRef.current = null;
      }
    };
  }, []);

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

  // No file selected - show placeholder
  if (!filePath && !activeTab) {
    return (
      <div className={`flex flex-col h-full bg-[#1e1e1e] ${className}`}>
        <EditorTabs />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <FileText className="w-12 h-12 text-[#6e7681] mx-auto" />
            <p className="text-[#8b8b8b]">Select a file from the explorer to view it</p>
            <p className="text-xs text-[#6e7681]">Double-click a file or press Enter</p>
          </div>
        </div>
      </div>
    );
  }

  const displayPath = filePath ?? activeTab;

  // Loading state
  if (loading) {
    return (
      <div className={`flex flex-col h-full bg-[#1e1e1e] ${className}`}>
        <EditorTabs />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <Loader2 className="w-8 h-8 text-[#007acc] animate-spin mx-auto" />
            <p className="text-sm text-[#8b8b8b]">Loading file...</p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className={`flex flex-col h-full bg-[#1e1e1e] ${className}`}>
        <EditorTabs />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4 max-w-md px-4">
            <AlertCircle className="w-8 h-8 text-[#f44747] mx-auto" />
            <p className="text-sm text-[#f44747]">Failed to load file</p>
            <p className="text-xs text-[#8b8b8b] break-all">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  const language = displayPath ? getLanguageName(displayPath) : 'Plain Text';

  return (
    <div className={`flex flex-col h-full bg-[#1e1e1e] ${className}`}>
      {/* Tab bar */}
      <EditorTabs />

      {/* Breadcrumb with symbol path */}
      <Breadcrumbs
        filePath={displayPath}
        symbolPath={symbolPath}
        onSymbolClick={navigateToSymbol}
      />

      {/* Editor container */}
      <div ref={containerRef} className="flex-1 overflow-hidden" />

      {/* Status bar */}
      <div className="flex items-center justify-between h-6 px-3 bg-[#007acc] text-white text-[12px]">
        <div className="flex items-center gap-4">
          <span>{language}</span>
          <span>UTF-8</span>
          {isDirty && <span className="text-yellow-200">Modified</span>}
          {saving && <span className="text-blue-200">Saving...</span>}
          {parseResults.isLoading && <span className="text-blue-200">Parsing...</span>}
        </div>
        <div className="flex items-center gap-4">
          <span>
            Ln {cursorPosition.line}, Col {cursorPosition.col}
          </span>
          {lineCount > 0 && <span>{lineCount} lines</span>}
          {parseResults.symbols.length > 0 && (
            <span title={`Parsed in ${parseResults.parseTimeMs}ms`}>
              {parseResults.symbols.length} symbols
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
