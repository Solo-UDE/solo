import { File as FileIcon, Image as ImageIcon, At } from '@phosphor-icons/react';
import { convertFileSrc } from '@tauri-apps/api/core';

import type { FC } from 'react';
import type { Attachment, FileMention } from '@/stores/agentStore';

export interface UserMessageProps {
  content: string;
  timestamp: Date;
  userName?: string;
  attachments?: Attachment[];
  mentions?: FileMention[];
  className?: string;
}

export const UserMessage: FC<UserMessageProps> = ({
  content,
  timestamp,
  userName = 'You',
  attachments,
  mentions,
  className = '',
}) => {
  const formatTime = (date: Date): string => {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  };

  const imageAttachments = attachments?.filter((a) => a.type === 'image');
  const fileAttachments = attachments?.filter((a) => a.type === 'file');

  return (
    <div className={`flex gap-3 px-4 ${className}`}>
      {/* Content */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{userName}</span>
          <span className="text-xs text-muted-foreground">{formatTime(timestamp)}</span>
        </div>
        <div className="text-sm text-foreground whitespace-pre-wrap break-words">
          {content}
        </div>

        {/* Attached images */}
        {imageAttachments && imageAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {imageAttachments.map((img) => (
              <div
                key={img.id}
                className="relative rounded-lg overflow-hidden bg-muted/40 border border-border/30"
                style={{ maxWidth: 200, maxHeight: 150 }}
              >
                <img
                  src={img.thumbnailUrl || convertFileSrc(img.path)}
                  alt={img.name}
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-0 inset-x-0 bg-black/50 px-2 py-0.5">
                  <span className="text-[10px] text-white truncate block">{img.name}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Attached files */}
        {fileAttachments && fileAttachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {fileAttachments.map((file) => (
              <div
                key={file.id}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/40 text-xs text-muted-foreground"
                title={file.path}
              >
                {file.mimeType?.startsWith('image/') ? (
                  <ImageIcon className="w-3.5 h-3.5 flex-shrink-0" />
                ) : (
                  <FileIcon className="w-3.5 h-3.5 flex-shrink-0" />
                )}
                <span className="truncate max-w-[150px]">{file.name}</span>
              </div>
            ))}
          </div>
        )}

        {/* Mentions */}
        {mentions && mentions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {mentions.map((mention) => (
              <div
                key={mention.path}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-xs text-primary"
                title={mention.path}
              >
                <At className="w-3 h-3 flex-shrink-0" />
                <span className="truncate max-w-[200px]">{mention.relativePath || mention.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
