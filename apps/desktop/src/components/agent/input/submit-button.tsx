import { ArrowUp } from '@phosphor-icons/react';
import { IconButton } from '@solo/ui';
import React from 'react';

export interface SubmitButtonProps {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

export const SubmitButton: React.FC<SubmitButtonProps> = ({
  onClick,
  disabled = false,
  className = '',
}) => {
  return (
    <IconButton
      variant="ghost"
      size="md"
      onClick={onClick}
      disabled={disabled}
      className={`
        h-[30px] w-[30px] rounded-[8px]
        bg-primary text-primary-foreground
        hover:brightness-110
        disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:brightness-100
        ${className}
      `}
      aria-label="Submit message"
    >
      <ArrowUp weight="bold" className="h-4 w-4" />
    </IconButton>
  );
};
