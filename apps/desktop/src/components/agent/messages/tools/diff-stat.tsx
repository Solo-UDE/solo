import type { FC } from 'react';

interface DiffStatProps {
  readonly additions: number;
  readonly deletions: number;
}

export const DiffStat: FC<DiffStatProps> = ({ additions, deletions }) => {
  const total = additions + deletions;
  const maxSquares = 5;

  let addSquares = 0;
  let delSquares = 0;
  let neutralSquares = 0;

  if (total > 0) {
    addSquares = Math.round((additions / total) * maxSquares);
    delSquares = Math.round((deletions / total) * maxSquares);
    if (additions > 0 && addSquares === 0) addSquares = 1;
    if (deletions > 0 && delSquares === 0) delSquares = 1;
    neutralSquares = maxSquares - addSquares - delSquares;
    if (neutralSquares < 0) neutralSquares = 0;
  } else {
    neutralSquares = maxSquares;
  }

  return (
    <div className="flex items-center gap-1.5">
      {additions > 0 ? (
        <span className="text-xs font-semibold text-success">+{additions}</span>
      ) : null}
      {deletions > 0 ? (
        <span className="text-xs font-semibold text-destructive">-{deletions}</span>
      ) : null}
      <div className="flex gap-px">
        {Array.from({ length: addSquares }).map((_, i) => (
          <div key={`add-${String(i)}`} className="w-2 h-2 rounded-sm bg-success" />
        ))}
        {Array.from({ length: delSquares }).map((_, i) => (
          <div key={`del-${String(i)}`} className="w-2 h-2 rounded-sm bg-destructive" />
        ))}
        {Array.from({ length: neutralSquares }).map((_, i) => (
          <div key={`neutral-${String(i)}`} className="w-2 h-2 rounded-sm bg-muted-foreground/30" />
        ))}
      </div>
    </div>
  );
};
