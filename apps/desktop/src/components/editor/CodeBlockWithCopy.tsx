/**
 * CodeBlockWithCopy - Code block wrapper with copy functionality
 * Used within MarkdownPreview to render fenced code blocks
 */

import { useState, useCallback, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';

interface CodeBlockWithCopyProps {
  children: ReactNode;
  className?: string;
  language?: string;
}

export function CodeBlockWithCopy({ children, className = '', language }: CodeBlockWithCopyProps) {
  const [copied, setCopied] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleCopy = useCallback(async () => {
    const codeElement = document.querySelector(`[data-code-id="${className}"]`);
    const text = codeElement?.textContent ?? '';

    try {
      await writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  }, [className]);

  return (
    <div
      className="code-block-wrapper"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {language && (
        <div className="code-block-header">
          <span className="code-block-language">{language}</span>
        </div>
      )}
      <div className="code-block-content">
        <pre className={className}>
          <code data-code-id={className}>{children}</code>
        </pre>
        <button
          onClick={handleCopy}
          className={`code-copy-button ${isHovered ? 'visible' : ''}`}
          title={copied ? 'Copied!' : 'Copy code'}
          aria-label={copied ? 'Copied!' : 'Copy code'}
        >
          {copied ? (
            <Check className="w-4 h-4 text-status-success" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * Custom code component for react-markdown
 * Handles both inline and block code
 */
interface CodeProps {
  node?: unknown;
  inline?: boolean;
  className?: string;
  children?: ReactNode;
}

export function MarkdownCode({ inline, className, children, ...props }: CodeProps) {
  const match = /language-(\w+)/.exec(className ?? '');
  const language = match ? match[1] : undefined;

  if (inline) {
    return (
      <code className="inline-code" {...props}>
        {children}
      </code>
    );
  }

  return (
    <CodeBlockWithCopy className={className ?? ''} language={language}>
      {children}
    </CodeBlockWithCopy>
  );
}
