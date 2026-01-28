import { useEffect, useState } from 'react';
import { codeToHtml } from 'shiki';

import { CopyButton } from './copy-button';

import type { FC } from 'react';
import type { ShikiTransformer } from 'shiki';

export interface CodeBlockProps {
  code: string;
  language: string;
  filename?: string;
  showLineNumbers?: boolean;
  className?: string;
}

export const CodeBlock: FC<CodeBlockProps> = ({
  code,
  language,
  filename,
  showLineNumbers = true,
  className = '',
}) => {
  const [html, setHtml] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const highlight = async (): Promise<void> => {
      try {
        const lineNumberTransformer: ShikiTransformer = {
          line(node, line) {
            node.properties['data-line'] = line;
          },
        };

        const highlighted = await codeToHtml(code, {
          lang: language,
          theme: 'github-dark',
          ...(showLineNumbers && { transformers: [lineNumberTransformer] }),
        });

        if (mounted) {
          setHtml(highlighted);
          setIsLoading(false);
        }
      } catch (error) {
        console.error('Error highlighting code:', error);
        if (mounted) {
          // Fallback to plain code
          setHtml(`<pre><code>${escapeHtml(code)}</code></pre>`);
          setIsLoading(false);
        }
      }
    };

    void highlight();

    return () => {
      mounted = false;
    };
  }, [code, language, showLineNumbers]);

  const escapeHtml = (text: string): string => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  return (
    <div className={`rounded-lg border bg-muted/50 overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-muted border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase">
            {language}
          </span>
          {filename ? (
            <>
              <span className="text-muted-foreground">•</span>
              <span className="text-xs text-muted-foreground font-mono">
                {filename}
              </span>
            </>
          ) : null}
        </div>
        <CopyButton text={code} />
      </div>

      {/* Code content */}
      <div className="relative overflow-x-auto">
        {isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">
            Loading syntax highlighting...
          </div>
        ) : (
          <div
            className="code-block-content"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  );
};
