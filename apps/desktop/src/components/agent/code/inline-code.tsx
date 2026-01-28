import type { FC, ReactNode } from 'react';

export interface InlineCodeProps {
  children: ReactNode;
  className?: string;
}

export const InlineCode: FC<InlineCodeProps> = ({
  children,
  className = '',
}) => {
  return (
    <code
      className={`
        px-1.5 py-0.5 rounded
        bg-muted border border-border
        text-sm font-mono
        text-foreground
        ${className}
      `}
    >
      {children}
    </code>
  );
};
