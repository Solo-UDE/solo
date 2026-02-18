import type { FC } from 'react';

export interface StreamingIndicatorProps {
  className?: string;
}

export const StreamingIndicator: FC<StreamingIndicatorProps> = ({ className = '' }) => {
  return (
    <div className={`flex items-center gap-1 h-6 ${className}`} aria-label="Agent is thinking">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 streaming-dot"
          style={{ animationDelay: `${i * 200}ms` }}
        />
      ))}
    </div>
  );
};
