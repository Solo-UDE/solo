/**
 * MarkdownPreview - Renders markdown content with Shiki syntax highlighting,
 * KaTeX math, mermaid diagrams, and GitHub-style callouts.
 */

import { forwardRef, type ReactNode } from 'react';
import Markdown from 'react-markdown';

import { CodeBlock, parseHighlightMeta, parseTitleMeta } from '@/components/shared/CodeBlock';
import { MermaidBlock } from '@/components/shared/MermaidBlock';
import { markdownTableComponents } from '@/components/shared/MarkdownTable';
import { sharedRemarkPlugins, sharedRehypePlugins } from '@/lib/markdown/plugins';
import { rehypeSourceLines } from '@/lib/markdown/rehype-source-lines';
import { parseCalloutType, renderCallout } from '@/lib/markdown/callouts';

import './markdown-preview.css';

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

/** Recursively extract text from React children. */
function extractText(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (!children) return '';
  if (Array.isArray(children)) return children.map(extractText).join('');
  if (typeof children === 'object' && 'props' in children) {
    return extractText((children as { props: { children?: ReactNode } }).props.children);
  }
  return '';
}

export const MarkdownPreview = forwardRef<HTMLDivElement, MarkdownPreviewProps>(
  function MarkdownPreview({ content, className = '' }, ref) {
    return (
      <div ref={ref} className={`markdown-preview ${className}`}>
        <div className="markdown-body">
          <Markdown
            remarkPlugins={sharedRemarkPlugins}
            rehypePlugins={[...sharedRehypePlugins, rehypeSourceLines]}
            components={{
              ...markdownTableComponents,
              code: (props) => {
                const { children, className: codeClassName } = props;
                const isInline = !codeClassName?.includes('language-');

                if (isInline) {
                  return (
                    <code className="inline-code">
                      {children}
                    </code>
                  );
                }

                const langMatch = /language-(\S+)/.exec(codeClassName ?? '');
                const language = langMatch?.[1] ?? 'text';
                const rawCode = extractText(children);

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
              pre: ({ children }) => <>{children}</>,
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              blockquote: ({ children, node, ...rest }) => {
                const childArray = Array.isArray(children) ? children : [children];
                const callout = parseCalloutType(childArray as ReactNode[]);

                if (callout) {
                  return <>{renderCallout(callout.type, callout.strippedChildren)}</>;
                }

                return (
                  <blockquote {...rest}>
                    {children}
                  </blockquote>
                );
              },
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              h1: ({ children, id, node, ...rest }) => (
                <h1 id={id} {...rest}>
                  {children}
                  <a href={`#${id ?? ''}`} className="heading-anchor" aria-hidden="true">#</a>
                </h1>
              ),
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              h2: ({ children, id, node, ...rest }) => (
                <h2 id={id} {...rest}>
                  {children}
                  <a href={`#${id ?? ''}`} className="heading-anchor" aria-hidden="true">#</a>
                </h2>
              ),
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              h3: ({ children, id, node, ...rest }) => (
                <h3 id={id} {...rest}>
                  {children}
                  <a href={`#${id ?? ''}`} className="heading-anchor" aria-hidden="true">#</a>
                </h3>
              ),
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              h4: ({ children, id, node, ...rest }) => (
                <h4 id={id} {...rest}>
                  {children}
                  <a href={`#${id ?? ''}`} className="heading-anchor" aria-hidden="true">#</a>
                </h4>
              ),
              img: ({ src, alt }) => (
                <img
                  src={src}
                  alt={alt ?? ''}
                  className="markdown-image"
                  loading="lazy"
                />
              ),
            }}
          >
            {content}
          </Markdown>
        </div>
      </div>
    );
  }
);
