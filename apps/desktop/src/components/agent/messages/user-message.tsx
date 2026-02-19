import { User, File as FileIcon, Image as ImageIcon } from '@phosphor-icons/react';
import { convertFileSrc } from '@tauri-apps/api/core';

import type { FC } from 'react';
import type { FileAttachment, ImageAttachment } from '@/stores/agentStore';

export interface UserMessageProps {
  content: string;
  timestamp: Date;
  avatarUrl?: string;
  userName?: string;
  attachedFiles?: FileAttachment[];
  attachedImages?: ImageAttachment[];
  className?: string;
}

export const UserMessage: FC<UserMessageProps> = ({
  content,
  timestamp,
  avatarUrl,
  userName = 'You',
  attachedFiles,
  attachedImages,
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

        {/* Attached images */}
        {attachedImages && attachedImages.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {attachedImages.map((img) => (
              <div
                key={img.path}
                className="relative rounded-lg overflow-hidden bg-muted/40 border border-border/30"
                style={{ maxWidth: 200, maxHeight: 150 }}
              >
                <img
                  src={img.previewUrl || convertFileSrc(img.path)}
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
        {attachedFiles && attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {attachedFiles.map((file) => (
              <div
                key={file.path}
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
      </div>
    </div>
  );
};
