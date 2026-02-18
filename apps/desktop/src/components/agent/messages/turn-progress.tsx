import type { FC } from 'react';

export interface TurnProgressProps {
  turnNumber: number;
  maxTurns?: number;
  className?: string;
}

export const TurnProgress: FC<TurnProgressProps> = ({
  turnNumber,
  maxTurns = 25,
  className = '',
}) => {
  return (
    <div className={`flex items-center justify-center py-1 ${className}`}>
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-muted/50 text-[10px] font-medium text-muted-foreground/70 tabular-nums">
        Turn {turnNumber}/{maxTurns}
      </span>
    </div>
  );
};
