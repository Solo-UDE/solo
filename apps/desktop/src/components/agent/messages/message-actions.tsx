import { Check, Copy, SpeakerHigh, Stop } from '@phosphor-icons/react';
import { IconButton } from '@solo/ui';
import { useState } from 'react';
import { useTextToSpeech } from '@/hooks/useTextToSpeech';

import type { FC } from 'react';

interface MessageActionsProps {
  readonly showDisclaimer?: boolean;
  readonly messageText?: string;
  readonly onCopy?: () => void;
}

export const MessageActions: FC<MessageActionsProps> = ({
  showDisclaimer = false,
  messageText,
  onCopy,
}) => {
  const [copied, setCopied] = useState(false);
  const { isSpeaking, speak, stop } = useTextToSpeech();

  const handleCopy = (): void => {
    onCopy?.();
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  const handleSpeak = (): void => {
    if (isSpeaking) {
      stop();
    } else if (messageText) {
      speak(messageText);
    }
  };

  return (
    <div className="mt-3 flex flex-col gap-2 items-end">
      <div className="flex items-center gap-1">
        {messageText && (
          <IconButton
            variant="ghost"
            size="sm"
            className="h-6 w-6"
            aria-label={isSpeaking ? 'Stop speaking' : 'Read aloud'}
            title={isSpeaking ? 'Stop speaking' : 'Read aloud'}
            onClick={handleSpeak}
          >
            {isSpeaking ? <Stop weight="fill" className="h-3.5 w-3.5" /> : <SpeakerHigh className="h-3.5 w-3.5" />}
          </IconButton>
        )}
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
      </div>
      {showDisclaimer ? (
        <p className="text-xs text-muted-foreground/70">
          Solo is AI and can make mistakes. Please double-check responses.
        </p>
      ) : null}
    </div>
  );
};
