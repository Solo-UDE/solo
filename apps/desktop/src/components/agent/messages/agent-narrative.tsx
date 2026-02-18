import ReactMarkdown from 'react-markdown';
import { useMemo, type FC, type ReactNode } from 'react';

import { CodeBlock, parseHighlightMeta, parseTitleMeta } from '@/components/shared/CodeBlock';
import { MermaidBlock } from '@/components/shared/MermaidBlock';
import { markdownTableComponents } from '@/components/shared/MarkdownTable';
import { sharedRemarkPlugins, sharedRehypePlugins } from '@/lib/markdown/plugins';
import { parseCalloutType, renderCallout } from '@/lib/markdown/callouts';
import { StreamingIndicator } from './streaming-indicator';

export interface AgentNarrativeProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
}

/**
 * Close unterminated fenced code blocks during streaming so
 * ReactMarkdown doesn't render the trailing content as inline text.
 */
function fixUnterminatedFences(md: string): string {
  const fencePattern = /^(`{3,})/gm;
  let openFence: string | null = null;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(md)) !== null) {
    if (!openFence) {
      openFence = match[1];
    } else if (match[1].length >= openFence.length) {
      openFence = null;
    }
  }

  if (openFence) {
    return md + '\n' + openFence;
  }
  return md;
}

/** Recursively extract text content from React children. */
function extractTextContent(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (!children) return '';

  if (Array.isArray(children)) {
    return children.map(extractTextContent).join('');
  }

  if (typeof children === 'object' && 'props' in children) {
    return extractTextContent((children as { props: { children?: ReactNode } }).props.children);
  }

  return '';
}

export const AgentNarrative: FC<AgentNarrativeProps> = ({
  content,
  isStreaming = false,
  className = '',
}) => {
  const processedContent = useMemo(
    () => (isStreaming ? fixUnterminatedFences(content) : content),
    [content, isStreaming],
  );

  // Show indicator when streaming with no content yet
  if (isStreaming && !content.trim()) {
    return <StreamingIndicator className={className} />;
  }

  return (
    <div
      className={`prose prose-sm dark:prose-invert max-w-none ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={sharedRemarkPlugins}
        rehypePlugins={sharedRehypePlugins}
        components={{
          ...markdownTableComponents,
          p: ({ children }) => (
            <p className="text-sm text-foreground leading-relaxed mb-2 last:mb-0">
              {children}
            </p>
          ),
          code: (props) => {
            const { children, className: codeClassName } = props;
            const isInline = !codeClassName?.includes('language-');

            if (isInline) {
              return (
                <code className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono text-foreground">
                  {children}
                </code>
              );
            }

            const langMatch = /language-(\S+)/.exec(codeClassName ?? '');
            const language = langMatch?.[1] ?? 'text';
            const rawCode = extractTextContent(children);

            if (language === 'mermaid') {
              return <MermaidBlock code={rawCode} />;
            }

            const meta = codeClassName ?? '';
            const highlightLines = parseHighlightMeta(meta);
            const title = parseTitleMeta(meta);

            return (
              <CodeBlock
                code={rawCode}
                language={language}
                title={title}
                highlightLines={highlightLines.size > 0 ? highlightLines : undefined}
                showLineNumbers={rawCode.split('\n').length > 3}
              />
            );
          },
          pre: ({ children }) => (
            // CodeBlock handles its own wrapper
            <>{children}</>
          ),
          ul: ({ children }) => (
            <ul className="list-disc list-inside space-y-1 my-2">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-inside space-y-1 my-2">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="text-sm text-foreground">{children}</li>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              className="text-primary hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
          h1: ({ children }) => (
            <h1 className="text-lg font-semibold text-foreground mb-2 mt-3">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-base font-semibold text-foreground mb-2 mt-3">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-semibold text-foreground mb-1 mt-2">
              {children}
            </h3>
          ),
          blockquote: ({ children }) => {
            const childArray = Array.isArray(children) ? children : [children];
            const callout = parseCalloutType(childArray as ReactNode[]);

            if (callout) {
              return <>{renderCallout(callout.type, callout.strippedChildren)}</>;
            }

            return (
              <blockquote className="border-l-2 border-muted-foreground pl-3 italic text-muted-foreground my-2">
                {children}
              </blockquote>
            );
          },
        }}
      >
        {processedContent}
      </ReactMarkdown>
      {/* Blinking cursor when streaming with content */}
      {isStreaming && content.trim() ? (
        <span className="inline-block w-[2px] h-4 bg-foreground/70 animate-pulse ml-0.5 align-text-bottom" />
      ) : null}
    </div>
  );
};
