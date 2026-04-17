/**
 * VaultDropZone — drag target plus a "Pick files…" button.
 *
 * V1: the button path is the reliable ingestion surface. True OS-level
 * drag-drop forwarding lands in V1.2 (Tauri `tauri://drag-drop` event).
 */

import { useState, type DragEvent, type FC } from 'react';
import { Upload, Plus } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { vaultDropPaths } from '@/lib/tauri/vault';
import { useVaultStore } from '@/stores/vaultStore';
import { cn } from '@/lib/utils';

export const VaultDropZone: FC = () => {
  const [isOver, setIsOver] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const activeScope = useVaultStore((s) => s.activeScope);
  const fetchEntries = useVaultStore((s) => s.fetchEntries);
  const fetchUnsortedCount = useVaultStore((s) => s.fetchUnsortedCount);

  const ingest = async (paths: string[]) => {
    if (paths.length === 0) return;
    setIsBusy(true);
    try {
      await vaultDropPaths(paths, activeScope, 'project');
      await fetchEntries();
      await fetchUnsortedCount();
    } catch (err) {
      console.error('vault ingestion failed', err);
    } finally {
      setIsBusy(false);
    }
  };

  const onPick = async () => {
    const selected = await open({ multiple: true, directory: false });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    await ingest(paths);
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsOver(true);
  };
  const onDragLeave = () => setIsOver(false);
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsOver(false);
    // V1.2 will listen to Tauri's native drag-drop event for real paths.
  };

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-4 py-8 rounded-xl transition-all duration-200',
        'bg-muted/20 border-2 border-dashed border-border/40',
        isOver && 'bg-primary/10 border-primary/50 scale-[1.01]',
      )}
    >
      <Upload
        className={cn(
          'w-7 h-7 transition-colors duration-150',
          isOver ? 'text-primary' : 'text-muted-foreground/50',
        )}
      />
      <p className="text-xs font-medium text-muted-foreground">
        {isBusy ? 'Indexing…' : 'Add files to the vault'}
      </p>
      <button
        type="button"
        onClick={onPick}
        disabled={isBusy}
        className={cn(
          'h-8 px-3 rounded-lg flex items-center gap-1.5 text-[11px] font-medium transition-all duration-150',
          'bg-primary text-primary-foreground hover:brightness-110 active:scale-[0.97]',
          isBusy && 'opacity-60 cursor-not-allowed',
        )}
      >
        <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
        Pick files…
      </button>
      <p className="text-[10px] text-muted-foreground/60 text-center leading-relaxed max-w-[220px]">
        Docs, code, images, data — the agent will remember them.
      </p>
    </div>
  );
};
