import { Copy, Check } from '@phosphor-icons/react';
import { useState } from 'react';

import type { FC } from 'react';

const TOAST_DURATION = 2000;

export interface CopyButtonProps {
  text: string;
  className?: string;
}

export const CopyButton: FC<CopyButtonProps> = ({ text, className = '' }) => {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setIsCopied(true);
      setTimeout(() => {
        setIsCopied(false);
      }, TOAST_DURATION);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`
        p-1.5 rounded
        hover:bg-muted transition-colors
        text-muted-foreground hover:text-foreground
        ${className}
      `}
      title={isCopied ? 'Copied!' : 'Copy to clipboard'}
    >
      {isCopied ? (
        <Check className="h-4 w-4 text-success" />
      ) : (
        <Copy className="h-4 w-4" />
      )}
    </button>
  );
};
