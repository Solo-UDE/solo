import { Check, Copy, ThumbsUp, ThumbsDown, SpeakerHigh, Stop } from '@phosphor-icons/react';
import { useState } from 'react';
import { useTextToSpeech } from '@/hooks/useTextToSpeech';

import type { FC } from 'react';

interface MessageActionsProps {
  readonly showDisclaimer?: boolean;
  readonly messageText?: string;
  readonly onCopy?: () => void;
  readonly onLike?: () => void;
  readonly onDislike?: () => void;
}

export const MessageActions: FC<MessageActionsProps> = ({
  showDisclaimer = false,
  messageText,
  onCopy,
  onLike,
  onDislike,
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
          <button
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title={isSpeaking ? 'Stop speaking' : 'Read aloud'}
            onClick={handleSpeak}
          >
            {isSpeaking ? <Stop weight="fill" className="h-3.5 w-3.5" /> : <SpeakerHigh className="h-3.5 w-3.5" />}
          </button>
        )}
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
