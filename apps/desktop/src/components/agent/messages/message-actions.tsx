import { Check, Copy, ThumbsUp, ThumbsDown } from '@phosphor-icons/react';
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
        <button
          className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title={copied ? 'Copied!' : 'Copy'}
          onClick={handleCopy}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        <button
          className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title="Like"
          onClick={onLike}
        >
          <ThumbsUp className="h-3.5 w-3.5" />
        </button>
        <button
          className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          title="Dislike"
          onClick={onDislike}
        >
          <ThumbsDown className="h-3.5 w-3.5" />
        </button>
      </div>
      {showDisclaimer ? (
        <p className="text-xs text-muted-foreground/70">
          Solo is AI and can make mistakes. Please double-check responses.
        </p>
      ) : null}
    </div>
  );
};
