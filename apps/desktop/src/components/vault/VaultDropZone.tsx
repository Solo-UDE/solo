/**
 * VaultDropZone — visual target for drag-and-drop.
 *
 * V0: purely visual. Real drop handling lands in Phase V1 once the Rust
 * pipeline is in place. Highlights on drag-over to teach the interaction.
 */

import { useState, type DragEvent, type FC } from 'react';
import { UploadSimple } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

export const VaultDropZone: FC = () => {
  const [isOver, setIsOver] = useState(false);

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsOver(true);
  };
  const onDragLeave = () => setIsOver(false);
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsOver(false);
    // V1: wire to vaultDropPaths once the native filesystem drop handler is in.
  };

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-4 py-10 rounded-[14px] transition-all duration-200',
        'bg-muted/20 border-2 border-dashed border-border/40',
        isOver && 'bg-primary/10 border-primary/50 scale-[1.01]',
      )}
    >
      <UploadSimple
        className={cn(
          'w-8 h-8 transition-colors duration-150',
          isOver ? 'text-primary' : 'text-muted-foreground/50',
        )}
        weight={isOver ? 'fill' : 'regular'}
      />
      <p className="text-xs font-medium text-muted-foreground">Drop files here</p>
      <p className="text-[10px] text-muted-foreground/60 text-center leading-relaxed max-w-[200px]">
        Docs, code, images, data — the agent will remember them.
      </p>
    </div>
  );
};
