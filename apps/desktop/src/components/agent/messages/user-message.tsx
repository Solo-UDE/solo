import { User, Paperclip } from '@phosphor-icons/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { FC } from 'react';
import type { Attachment, FileMention } from '../../../stores/agentStore';

export interface UserMessageProps {
  content: string;
  timestamp: Date;
  avatarUrl?: string;
  userName?: string;
  className?: string;
  attachments?: Attachment[];
  mentions?: FileMention[];
}

export const UserMessage: FC<UserMessageProps> = ({
  content,
  timestamp,
  avatarUrl,
  userName = 'You',
  className = '',
  attachments,
  mentions,
}) => {
  const formatTime = (date: Date): string => {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  };

  const imageAttachments = attachments?.filter((a) => a.type === 'image') ?? [];
  const fileAttachments = attachments?.filter((a) => a.type === 'file') ?? [];

  return (
    <div className={`flex gap-3 px-4 ${className}`}>
      {/* Avatar */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden">
        {avatarUrl ? (
          <img src={avatarUrl} alt={userName} className="w-full h-full object-cover" />
        ) : (
          <User className="w-4 h-4 text-primary" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{userName}</span>
          <span className="text-xs text-muted-foreground">{formatTime(timestamp)}</span>
        </div>
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => (
                <p className="text-sm text-foreground leading-relaxed mb-1 last:mb-0">
                  {children}
                </p>
              ),
              code: ({ children, className }) => {
                const isInline = !className?.includes('language-');
                if (isInline) {
                  return (
                    <code className="px-1 py-0.5 rounded bg-muted text-xs font-mono text-foreground">
                      {children}
                    </code>
                  );
                }
                return (
                  <code className={`block p-2 rounded-md bg-muted text-xs font-mono overflow-x-auto ${className ?? ''}`}>
                    {children}
                  </code>
                );
              },
              pre: ({ children }) => (
                <pre className="my-1 overflow-x-auto">{children}</pre>
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        </div>

        {/* Image attachments */}
        {imageAttachments.length > 0 && (
          <div className="flex gap-2 flex-wrap pt-1">
            {imageAttachments.map((img) => (
              <div
                key={img.id}
                className="w-20 h-20 rounded-md overflow-hidden border border-border/50 bg-muted"
              >
                <img
                  src={img.thumbnailUrl}
                  alt={img.name}
                  className="w-full h-full object-cover"
                />
              </div>
            ))}
          </div>
        )}

        {/* File attachments */}
        {fileAttachments.length > 0 && (
          <div className="flex gap-1.5 flex-wrap pt-1">
            {fileAttachments.map((file) => (
              <div
                key={file.id}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/60 text-xs"
              >
                <Paperclip className="w-3 h-3 text-muted-foreground shrink-0" />
                <span className="truncate max-w-[140px] text-foreground">{file.name}</span>
              </div>
            ))}
          </div>
        )}

        {/* Mentions */}
        {mentions && mentions.length > 0 && (
          <div className="flex gap-1.5 flex-wrap pt-1">
            {mentions.map((mention, i) => (
              <span
                key={`${mention.path}-${i}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-xs text-primary"
              >
                @{mention.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
