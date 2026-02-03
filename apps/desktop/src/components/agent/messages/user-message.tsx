import { Paperclip, User } from 'lucide-react';

import type { Attachment, FileMention } from '../../../stores/agentStore';
import type { FC } from 'react';

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
        <div className="text-sm text-foreground whitespace-pre-wrap break-words">
          {content}
        </div>

        {/* Attachments */}
        {attachments && attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {attachments.filter((a) => a.type === 'image').map((img) => (
              <div key={img.id} className="w-20 h-20 rounded-md overflow-hidden border border-border bg-muted">
                <img src={img.thumbnailUrl} alt={img.name} className="w-full h-full object-cover" />
              </div>
            ))}
            {attachments.filter((a) => a.type === 'file').map((file) => (
              <span key={file.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted text-xs border border-border">
                <Paperclip className="w-3 h-3 text-muted-foreground" />
                <span className="truncate max-w-[120px]">{file.name}</span>
              </span>
            ))}
          </div>
        )}

        {/* Mentions */}
        {mentions && mentions.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {mentions.map((m) => (
              <span key={m.path} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-xs">
                @{m.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
