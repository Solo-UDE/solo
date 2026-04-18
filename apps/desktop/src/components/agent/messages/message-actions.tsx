import { CheckIcon, CopyIcon } from '@radix-ui/react-icons';
import { IconButton } from '@solo/ui';
import { useState } from 'react';

import type { FC } from 'react';

interface MessageActionsProps {
  readonly showDisclaimer?: boolean;
  readonly messageText?: string;
  readonly onCopy?: () => void;
}

export const MessageActions: FC<MessageActionsProps> = ({
  showDisclaimer = false,
  messageText: _messageText,
  onCopy,
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
          {copied ? <CheckIcon width={14} height={14} aria-hidden="true" /> : <CopyIcon width={14} height={14} aria-hidden="true" />}
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
