/**
 * VaultDropZone — drag target plus a "Pick files…" button.
 *
 * V1: the button path is the reliable ingestion surface. True OS-level
 * drag-drop forwarding lands in V1.2 (Tauri `tauri://drag-drop` event).
 */

import { useState, type DragEvent, type FC } from 'react';
import { CloudUpload, HardDrive, Plus, Upload } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { vaultDropPaths } from '@/lib/tauri/vault';
import { useVaultStore } from '@/stores/vaultStore';
import { cn } from '@/lib/utils';

export const VaultDropZone: FC = () => {
  const [isOver, setIsOver] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const activeScope = useVaultStore((s) => s.activeScope);
  const syncToCloud = useVaultStore((s) => s.syncToCloud);
  const setSyncToCloud = useVaultStore((s) => s.setSyncToCloud);
  const fetchEntries = useVaultStore((s) => s.fetchEntries);
  const fetchUnsortedCount = useVaultStore((s) => s.fetchUnsortedCount);

  const ingest = async (paths: string[]) => {
    if (paths.length === 0) return;
    setIsBusy(true);
    try {
      await vaultDropPaths(paths, activeScope, 'project', syncToCloud);
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
        {isBusy
          ? syncToCloud
            ? 'Indexing and syncing…'
            : 'Indexing locally…'
          : 'Add files to the vault'}
      </p>
      <div
        className="flex h-7 items-center rounded-lg bg-muted/40 p-0.5"
        role="group"
        aria-label="Vault storage mode"
      >
        <button
          type="button"
          onClick={() => setSyncToCloud(true)}
          className={cn(
            'flex h-6 items-center gap-1 rounded-md px-2 text-[10px] font-medium transition-all duration-150 active:scale-[0.97]',
            syncToCloud
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
          title="Sync new files to cloud"
        >
          <CloudUpload className="h-3 w-3" />
          Cloud
        </button>
        <button
          type="button"
          onClick={() => setSyncToCloud(false)}
          className={cn(
            'flex h-6 items-center gap-1 rounded-md px-2 text-[10px] font-medium transition-all duration-150 active:scale-[0.97]',
            !syncToCloud
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
          title="Keep new files local"
        >
          <HardDrive className="h-3 w-3" />
          Local
        </button>
      </div>
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
