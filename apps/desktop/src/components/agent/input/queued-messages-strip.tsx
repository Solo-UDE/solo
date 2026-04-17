import { Cross2Icon } from '@radix-ui/react-icons';
import { Paperclip } from 'lucide-react';

import { AnimatedList } from '@/components/ui/animated-list';
import { useSessionQueue, useAgentStore } from '../../../stores/agentStore';

import type { FC } from 'react';

export interface QueuedMessagesStripProps {
  sessionId: string | null;
  className?: string;
}

const PREVIEW_CHAR_LIMIT = 160;

function previewOf(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= PREVIEW_CHAR_LIMIT) return trimmed;
  return trimmed.slice(0, PREVIEW_CHAR_LIMIT - 1) + '…';
}

export const QueuedMessagesStrip: FC<QueuedMessagesStripProps> = ({ sessionId, className = '' }) => {
  const queue = useSessionQueue(sessionId);
  const removeQueuedMessage = useAgentStore((s) => s.removeQueuedMessage);

  if (!sessionId || queue.length === 0) return null;

  return (
    <div className={`w-full max-w-3xl mx-auto px-3 pb-1 ${className}`}>
      <AnimatedList className="flex flex-col gap-1.5" stagger={0.02} slideY={4} animateExit>
        {queue.map((item) => {
          const attachmentCount = item.attachments?.length ?? 0;
          return (
            <div
              key={item.id}
              className="group flex items-start gap-2 rounded-[12px] bg-muted/50 backdrop-blur-sm px-3 py-2 ring-1 ring-white/[0.04] hover:bg-muted/70 transition-colors"
              title="Queued — will be sent when the current turn finishes"
            >
              <span
                className="mt-1 shrink-0 h-1.5 w-1.5 rounded-full bg-primary/70 animate-pulse"
                aria-hidden
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs leading-snug text-foreground/90 line-clamp-2 break-words whitespace-pre-wrap">
                  {previewOf(item.content)}
                </p>
                {attachmentCount > 0 && (
                  <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Paperclip className="h-3 w-3" />
                    {attachmentCount} attachment{attachmentCount === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeQueuedMessage(sessionId, item.id)}
                className="shrink-0 inline-flex items-center justify-center h-5 w-5 rounded-[6px] text-muted-foreground/70 hover:text-foreground hover:bg-muted/80 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                aria-label="Remove from queue"
                title="Remove from queue"
              >
                <Cross2Icon width={10} height={10} />
              </button>
            </div>
          );
        })}
      </AnimatedList>
    </div>
  );
};
