import { useEffect, useState, type FC } from 'react';

interface ElapsedTimerProps {
  startTime: number;
  className?: string;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

export const ElapsedTimer: FC<ElapsedTimerProps> = ({ startTime, className = '' }) => {
  const [elapsed, setElapsed] = useState(() => Date.now() - startTime);

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 100);
    return () => clearInterval(id);
  }, [startTime]);

  return (
    <span className={`text-[11px] text-muted-foreground/60 tabular-nums ${className}`}>
      {formatElapsed(elapsed)}
    </span>
  );
};
