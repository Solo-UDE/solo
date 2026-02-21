import { useEffect, useState, type FC } from 'react';

type CellValue = 1 | 0.4 | 0;

function randomCell(): CellValue {
  const r = Math.random();
  if (r < 0.4) return 1;
  if (r < 0.7) return 0.4;
  return 0;
}

function randomGrid(): CellValue[] {
  return Array.from({ length: 9 }, randomCell);
}

export const AgentLoadingGrid: FC<{ className?: string }> = ({ className = '' }) => {
  const [cells, setCells] = useState(randomGrid);

  useEffect(() => {
    const id = setInterval(() => setCells(randomGrid()), 150);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className={`grid grid-cols-3 gap-[2px] w-4 h-4 text-muted-foreground ${className}`}
      aria-hidden="true"
    >
      {cells.map((opacity, i) => (
        <span
          key={i}
          className="rounded-[1px]"
          style={{
            backgroundColor: opacity > 0 ? 'currentColor' : 'transparent',
            opacity: opacity > 0 ? opacity : undefined,
          }}
        />
      ))}
    </div>
  );
};
