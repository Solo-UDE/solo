import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { useState } from 'react';

import type { FC } from 'react';

export interface MessageFeedbackProps {
  onFeedback: (feedback: 'good' | 'bad') => void;
  className?: string;
}

export const MessageFeedback: FC<MessageFeedbackProps> = ({
  onFeedback,
  className = '',
}) => {
  const [selected, setSelected] = useState<'good' | 'bad' | null>(null);

  const handleFeedback = (feedback: 'good' | 'bad'): void => {
    setSelected(feedback);
    onFeedback(feedback);
  };

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <button
        onClick={() => {
          handleFeedback('good');
        }}
        disabled={selected !== null}
        className={`p-1.5 rounded transition-colors ${
          selected === 'good'
            ? 'bg-success-muted text-success'
            : selected === null
            ? 'hover:bg-accent text-muted-foreground hover:text-foreground'
            : 'text-muted-foreground/50 cursor-not-allowed'
        }`}
        title="Good response"
        aria-label="Good response"
      >
        <ThumbsUp className="w-3.5 h-3.5" />
      </button>

      <button
        onClick={() => {
          handleFeedback('bad');
        }}
        disabled={selected !== null}
        className={`p-1.5 rounded transition-colors ${
          selected === 'bad'
            ? 'bg-destructive/10 text-destructive'
            : selected === null
            ? 'hover:bg-accent text-muted-foreground hover:text-foreground'
            : 'text-muted-foreground/50 cursor-not-allowed'
        }`}
        title="Bad response"
        aria-label="Bad response"
      >
        <ThumbsDown className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
