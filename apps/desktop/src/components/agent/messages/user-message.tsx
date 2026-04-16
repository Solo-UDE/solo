import { FileIcon, ImageIcon } from '@radix-ui/react-icons';
import { AtSign } from 'lucide-react';
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
  timestamp: _timestamp,
  userName: _userName = 'You',
  attachments,
  mentions,
  className = '',
}) => {
  const imageAttachments = attachments?.filter((a) => a.type === 'image');
  const fileAttachments = attachments?.filter((a) => a.type === 'file');

  return (
    <div className={`flex justify-end px-3 chat-surface ${className}`}>
      {/* Neutral bubble — Orbit style (no green border, no username header) */}
      <div className="max-w-[85%] rounded-xl bg-agent-user-bg text-foreground px-3.5 py-2.5 space-y-1 shadow-xs">
        <div className="text-[13px] whitespace-pre-wrap break-words leading-relaxed">
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
                  <ImageIcon width={14} height={14} className="flex-shrink-0" />
                ) : (
                  <FileIcon width={14} height={14} className="flex-shrink-0" />
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
                className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/40 text-xs text-muted-foreground"
                title={mention.path}
              >
                <AtSign className="w-3 h-3 flex-shrink-0" />
                <span className="truncate max-w-[200px]">{mention.relativePath || mention.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
