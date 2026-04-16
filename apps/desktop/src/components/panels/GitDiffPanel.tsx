/**
 * GitDiffPanel — side-by-side diff view using Monaco DiffEditor
 */

import { useState, useEffect, useCallback } from 'react';
import { DiffEditor, type BeforeMount } from '@monaco-editor/react';
import { ExclamationTriangleIcon } from '@radix-ui/react-icons';
import { CodeSkeleton } from '@/components/ui/skeletons';
import { gitGetFileDiff } from '@/lib/tauri/git';
import { registerSoloTheme, SOLO_THEME_NAME } from '@/components/editor/theme';
import type { PanelProps } from '@/lib/panels/types';

interface GitDiffData {
  filePath: string;
  fileName?: string;
}

/** Get Monaco language ID from file extension */
function getMonacoLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    rs: 'rust',
    go: 'go',
    py: 'python',
    java: 'java',
    json: 'json',
    html: 'html',
    css: 'css',
    scss: 'scss',
    md: 'markdown',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'ini',
    sh: 'shell',
    bash: 'shell',
    sql: 'sql',
    xml: 'xml',
    svelte: 'html',
    vue: 'html',
    graphql: 'graphql',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
  };
  return langMap[ext] ?? 'plaintext';
}

export const GitDiffPanel = ({
  data,
  onTitleChange,
}: PanelProps<GitDiffData>) => {
  const [oldContent, setOldContent] = useState<string>('');
  const [newContent, setNewContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filePath = data.filePath as string;
  const fileName = data.fileName as string | undefined;

  // Update title
  useEffect(() => {
    if (fileName) {
      onTitleChange(`Diff: ${fileName}`);
    }
  }, [fileName, onTitleChange]);

  // Fetch diff content
  useEffect(() => {
    if (!filePath) return;

    setIsLoading(true);
    setError(null);

    gitGetFileDiff(filePath)
      .then((result) => {
        setOldContent(result.old_content);
        setNewContent(result.new_content);
        setIsLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setIsLoading(false);
      });
  }, [filePath]);

  const language = getMonacoLanguage(filePath ?? '');

  const handleEditorWillMount: BeforeMount = useCallback((monaco) => {
    registerSoloTheme(monaco);
  }, []);

  if (isLoading) {
    return (
      <div className="h-full">
        <CodeSkeleton lines={14} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 px-6">
        <ExclamationTriangleIcon className="w-6 h-6 text-destructive" />
        <p className="text-xs text-muted-foreground text-center">{error}</p>
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <DiffEditor
        original={oldContent}
        modified={newContent}
        language={language}
        theme={SOLO_THEME_NAME}
        beforeMount={handleEditorWillMount}
        options={{
          readOnly: true,
          renderSideBySide: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 12,
          lineHeight: 20,
          padding: { top: 8 },
          renderOverviewRuler: false,
          diffWordWrap: 'on',
          ignoreTrimWhitespace: false,
        }}
      />
    </div>
  );
};
