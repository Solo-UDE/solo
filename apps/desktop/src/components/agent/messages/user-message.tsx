import { FileIcon, ImageIcon } from '@radix-ui/react-icons';
import { AtSign, Zap } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';

import type { FC, ReactNode } from 'react';
import type { Attachment, FileMention, UserContentPart } from '@/stores/agentStore';

export interface UserMessageProps {
  content: string;
  timestamp: Date;
  userName?: string;
  attachments?: Attachment[];
  mentions?: FileMention[];
  /** Flat skill names — fallback for messages without ordered `parts`. */
  skills?: string[];
  /** Ordered text/skill sequence from the editor. When present, wins over `skills` + `content`. */
  parts?: UserContentPart[];
  className?: string;
}

/** Inline chip styling shared between the interleaved renderer and the legacy header-chip fallback. */
const InlineSkillChip: FC<{ name: string }> = ({ name }) => (
  <span
    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 mx-0.5 rounded bg-primary/15 text-primary text-[11px] font-medium align-middle"
    title={`/${name}`}
  >
    <Zap className="w-3 h-3 shrink-0" />
    <span>/{name}</span>
  </span>
);

/**
 * Render the interleaved `parts` array preserving chip-in-the-middle order.
 * Text parts that are just whitespace-between-chips are kept verbatim so the
 * bubble matches what the user typed.
 */
function renderParts(parts: UserContentPart[]): ReactNode {
  return parts.map((p, i) => {
    if (p.type === 'skill') return <InlineSkillChip key={`skill-${i}`} name={p.name} />;
    return <span key={`text-${i}`}>{p.text}</span>;
  });
}

export const UserMessage: FC<UserMessageProps> = ({
  content,
  timestamp: _timestamp,
  userName: _userName = 'You',
  attachments,
  mentions,
  skills,
  parts,
  className = '',
}) => {
  const imageAttachments = attachments?.filter((a) => a.type === 'image');
  const fileAttachments = attachments?.filter((a) => a.type === 'file');

  return (
    <div className={`chat-surface flex justify-end ${className}`}>
      <div className="max-w-[min(46rem,88%)] space-y-2 rounded-[12px] border border-border/80 bg-agent-user-bg px-4 py-3 text-foreground shadow-[0_16px_28px_-28px_rgba(0,0,0,0.3)]">
        <div className="text-[13px] whitespace-pre-wrap break-words leading-relaxed">
          {parts && parts.length > 0 ? (
            // Ordered rendering: chips appear exactly where the user put them.
            renderParts(parts)
          ) : (
            <>
              {/* Fallback for messages without `parts` (legacy or missing): chips grouped up front. */}
              {skills && skills.length > 0 && (
                <span className="inline-flex flex-wrap gap-1 mr-1.5 align-middle">
                  {skills.map((name) => (
                    <InlineSkillChip key={name} name={name} />
                  ))}
                </span>
              )}
              {content}
            </>
          )}
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
                className="flex items-center gap-1.5 rounded-[12px] border border-border/50 bg-background/55 px-2.5 py-1.5 text-xs text-muted-foreground"
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
                className="flex items-center gap-1 rounded-[12px] border border-border/50 bg-background/55 px-2.5 py-1 text-xs text-muted-foreground"
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
