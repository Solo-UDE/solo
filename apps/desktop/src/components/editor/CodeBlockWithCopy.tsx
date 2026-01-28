/**
 * CodeBlockWithCopy - Code block wrapper with copy functionality
 * Used within MarkdownPreview to render fenced code blocks
 */

import { useState, useCallback, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { cn } from '@/lib/utils';

interface CodeBlockWithCopyProps {
  children: ReactNode;
  className?: string;
  language?: string;
}

export function CodeBlockWithCopy({ children, className = '', language }: CodeBlockWithCopyProps) {
  const [copied, setCopied] = useState(false);

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
    <div className="code-block-wrapper">
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
          className={cn('code-copy-button', copied && 'copied')}
          title={copied ? 'Copied!' : 'Copy code'}
          aria-label={copied ? 'Copied!' : 'Copy code'}
        >
          {copied ? (
            <Check className="w-3.5 h-3.5" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * Custom pre component for react-markdown
 * Wraps block code with copy functionality
 */
interface PreProps {
  children?: ReactNode;
}

export function MarkdownPre({ children }: PreProps) {
  // Extract language and content from the code child
  let language: string | undefined;
  let codeClassName = '';

  // children is typically a <code> element for fenced code blocks
  if (children && typeof children === 'object' && 'props' in children) {
    const codeProps = (children as { props?: { className?: string } }).props;
    codeClassName = codeProps?.className ?? '';
    const match = /language-(\w+)/.exec(codeClassName);
    language = match ? match[1] : undefined;
  }

  return (
    <CodeBlockWithCopy className={codeClassName} language={language}>
      {children}
    </CodeBlockWithCopy>
  );
}

/**
 * Custom code component for react-markdown
 * Only handles inline code - block code is handled by MarkdownPre
 */
interface CodeProps {
  className?: string;
  children?: ReactNode;
}

export function MarkdownCode({ className, children, ...props }: CodeProps) {
  // If className exists (language-*), this is inside a <pre> and will be handled by MarkdownPre
  // Just render the code element for the pre wrapper to use
  if (className) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  // Inline code - no language class
  return (
    <code className="inline-code" {...props}>
      {children}
    </code>
  );
}
