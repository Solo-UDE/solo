import { ArrowUp } from '@phosphor-icons/react';
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
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        inline-flex items-center justify-center
        h-[30px] w-[30px] rounded-[8px]
        bg-primary text-primary-foreground
        hover:brightness-110 hover:scale-105
        active:scale-95
        focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/30
        transition-[transform,background-color,color] duration-200
        disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:brightness-100
        ${className}
      `}
      aria-label="Submit message"
    >
      <ArrowUp className="h-4 w-4" />
    </button>
  );
};
