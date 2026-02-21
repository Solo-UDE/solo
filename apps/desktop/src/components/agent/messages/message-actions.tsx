import { Check, Copy, ThumbsUp, ThumbsDown } from '@phosphor-icons/react';
import { IconButton } from '@solo/ui';
import { useState } from 'react';

import type { FC } from 'react';

interface MessageActionsProps {
  readonly showDisclaimer?: boolean;
  readonly onCopy?: () => void;
  readonly onLike?: () => void;
  readonly onDislike?: () => void;
}

export const MessageActions: FC<MessageActionsProps> = ({
  showDisclaimer = false,
  onCopy,
  onLike,
  onDislike,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (): void => {
    onCopy?.();
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  return (
    <div className="mt-3 flex flex-col gap-2 items-end">
      <div className="flex items-center gap-1">
        <IconButton
          variant="ghost"
          size="sm"
          className="h-6 w-6"
          aria-label={copied ? 'Copied' : 'Copy message'}
          title={copied ? 'Copied!' : 'Copy'}
          onClick={handleCopy}
        >
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
        </IconButton>
        <IconButton
          variant="ghost"
          size="sm"
          className="h-6 w-6"
          aria-label="Like message"
          title="Like"
          onClick={onLike}
        >
          <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
        </IconButton>
        <IconButton
          variant="ghost"
          size="sm"
          className="h-6 w-6"
          aria-label="Dislike message"
          title="Dislike"
          onClick={onDislike}
        >
          <ThumbsDown className="h-3.5 w-3.5" aria-hidden="true" />
        </IconButton>
      </div>
      {showDisclaimer ? (
        <p className="text-xs text-muted-foreground/70">
          Solo is AI and can make mistakes. Please double-check responses.
        </p>
      ) : null}
    </div>
  );
};
