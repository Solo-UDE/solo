import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { FC } from 'react';

export interface AgentNarrativeProps {
  content: string;
  className?: string;
}

export const AgentNarrative: FC<AgentNarrativeProps> = ({
  content,
  className = '',
}) => {
  return (
    <div
      className={`prose prose-sm dark:prose-invert max-w-none ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Customize markdown rendering
          p: ({ children }) => (
            <p className="text-sm text-foreground leading-relaxed mb-2 last:mb-0">
              {children}
            </p>
          ),
          code: (props) => {
            const { children, className } = props;
            const isInline = !className?.includes('language-');
            if (isInline) {
              return (
                <code className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono text-foreground">
                  {children}
                </code>
              );
            }
            return (
              <code className={`block p-3 rounded-md bg-muted text-xs font-mono overflow-x-auto ${className ?? ''}`}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto">{children}</pre>
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
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-muted-foreground pl-3 italic text-muted-foreground my-2">
              {children}
            </blockquote>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
