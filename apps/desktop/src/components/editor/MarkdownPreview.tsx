/**
 * MarkdownPreview - Renders markdown content with syntax highlighting
 * Uses react-markdown with remark-gfm for GitHub Flavored Markdown
 */

import { useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { MarkdownCode } from './CodeBlockWithCopy';
import './markdown-preview.css';

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

export function MarkdownPreview({ content, className = '' }: MarkdownPreviewProps) {
  const remarkPlugins = useMemo(() => [remarkGfm], []);
  const rehypePlugins = useMemo(() => [rehypeHighlight], []);

  return (
    <div className={`markdown-preview ${className}`}>
      <div className="markdown-body">
        <Markdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          components={{
            code: MarkdownCode,
          }}
        >
          {content}
        </Markdown>
      </div>
    </div>
  );
}
