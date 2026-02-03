/**
 * FileViewer - Simple file content viewer
 * Displays file contents with basic syntax highlighting
 */

import { useState, useEffect } from 'react';
import { FileText, CircleNotch, WarningCircle } from '@phosphor-icons/react';
import * as fs from '../../lib/tauri/fs';

interface FileViewerProps {
  filePath: string | null;
  className?: string;
}

// Get language from file extension
function getLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    rs: 'rust',
    py: 'python',
    go: 'go',
    java: 'java',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    md: 'markdown',
    html: 'html',
    css: 'css',
    scss: 'scss',
    sql: 'sql',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
  };
  return langMap[ext] ?? 'plaintext';
}

export function FileViewer({ filePath, className = '' }: FileViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!filePath) {
      setContent(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    fs.readFile(filePath)
      .then((response) => {
        setContent(response.content);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to read file:', err);
        setError(err?.message ?? String(err));
        setContent(null);
        setLoading(false);
      });
  }, [filePath]);

  if (!filePath) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="text-center space-y-4">
          <FileText className="w-12 h-12 text-muted-foreground/50 mx-auto" />
          <p className="text-muted-foreground">
            Select a file from the explorer to view it
          </p>
          <p className="text-xs text-muted-foreground/60">
            Double-click a file or press Enter
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="text-center space-y-4">
          <CircleNotch weight="bold" className="w-8 h-8 text-primary animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Loading file...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="text-center space-y-4 max-w-md px-4">
          <WarningCircle className="w-8 h-8 text-destructive mx-auto" />
          <p className="text-sm text-destructive">Failed to load file</p>
          <p className="text-xs text-muted-foreground break-all">{error}</p>
        </div>
      </div>
    );
  }

  const fileName = filePath.split('/').pop() ?? '';
  const language = getLanguage(filePath);
  const lines = content?.split('\n') ?? [];
  const lineNumberWidth = String(lines.length).length;

  return (
    <div className={`flex flex-col h-full bg-background ${className}`}>
      {/* Tab bar */}
      <div className="flex items-center h-8 bg-card/80 backdrop-blur-sm border-b border-border/30">
        <div className="flex items-center gap-2 px-4 py-1.5 bg-background shadow-sm rounded-t-lg">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <span className="text-[13px] text-foreground">{fileName}</span>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="flex items-center h-7 px-3 bg-background/80 backdrop-blur-sm border-b border-border/20">
        <span className="text-[11px] text-muted-foreground truncate">{filePath}</span>
      </div>

      {/* Editor content */}
      <div className="flex-1 overflow-auto">
        <div className="flex min-h-full">
          {/* Line numbers gutter */}
          <div className="flex-shrink-0 select-none bg-background border-r border-border">
            {lines.map((_, i) => (
              <div
                key={i}
                className="text-right text-[13px] text-muted-foreground font-mono leading-[22px] pr-4 pl-4"
                style={{ minWidth: `${lineNumberWidth + 4}ch` }}
              >
                {i + 1}
              </div>
            ))}
          </div>

          {/* Code content */}
          <pre className="flex-1 pl-4 overflow-x-auto bg-background">
            <code className="text-[13px] font-mono leading-[22px] text-foreground">
              {lines.map((line, i) => (
                <div key={i} className="whitespace-pre hover:bg-muted/60 transition-colors duration-150">
                  {line || '\u00A0'}
                </div>
              ))}
            </code>
          </pre>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between h-6 px-3 bg-primary text-primary-foreground text-[12px]">
        <div className="flex items-center gap-4">
          <span>{language}</span>
          <span>UTF-8</span>
        </div>
        <div className="flex items-center gap-4">
          <span>Ln {lines.length}, Col 1</span>
        </div>
      </div>
    </div>
  );
}
