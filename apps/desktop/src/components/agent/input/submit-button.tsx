import { ArrowUp } from 'lucide-react';
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
        h-9 w-9 rounded-lg
        bg-primary hover:bg-primary/90
        focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2
        transition-colors
        disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary
        ${className}
      `}
      aria-label="Submit message"
    >
      <ArrowUp className="h-5 w-5 text-primary-foreground" />
    </button>
  );
};
