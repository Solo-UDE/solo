import { User } from 'lucide-react';

import type { FC } from 'react';

export interface UserMessageProps {
  content: string;
  timestamp: Date;
  avatarUrl?: string;
  userName?: string;
  className?: string;
}

export const UserMessage: FC<UserMessageProps> = ({
  content,
  timestamp,
  avatarUrl,
  userName = 'You',
  className = '',
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
      </div>
    </div>
  );
};
