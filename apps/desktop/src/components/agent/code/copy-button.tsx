import { CopyIcon, CheckIcon } from '@radix-ui/react-icons';
import { useState } from 'react';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';

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
      await writeText(text);
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
      <span className="relative w-4 h-4 inline-flex">
        <CopyIcon width={16} height={16} className={`absolute inset-0 transition-opacity duration-150 ${isCopied ? 'opacity-0' : 'opacity-100'}`} />
        <CheckIcon width={16} height={16} className={`absolute inset-0 transition-opacity duration-150 text-success ${isCopied ? 'opacity-100' : 'opacity-0'}`} />
      </span>
    </button>
  );
};
