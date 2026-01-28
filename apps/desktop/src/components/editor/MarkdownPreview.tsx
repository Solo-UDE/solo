/**
 * MarkdownPreview - Renders markdown content with syntax highlighting
 * Uses react-markdown with remark-gfm for GitHub Flavored Markdown
 */

import { useMemo, forwardRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { MarkdownCode, MarkdownPre } from './CodeBlockWithCopy';
import './markdown-preview.css';

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

export const MarkdownPreview = forwardRef<HTMLDivElement, MarkdownPreviewProps>(
  function MarkdownPreview({ content, className = '' }, ref) {
    const remarkPlugins = useMemo(() => [remarkGfm], []);
    const rehypePlugins = useMemo(() => [rehypeHighlight], []);

    return (
      <div ref={ref} className={`markdown-preview ${className}`}>
        <div className="markdown-body">
          <Markdown
            remarkPlugins={remarkPlugins}
            rehypePlugins={rehypePlugins}
            components={{
              pre: MarkdownPre,
              code: MarkdownCode,
            }}
          >
            {content}
          </Markdown>
        </div>
      </div>
    );
  }
);
