/**
 * VaultDropZone — drag target plus a "Pick files…" button.
 *
 * V1: the button path is the reliable ingestion surface. True OS-level
 * drag-drop forwarding lands in V1.2 (Tauri `tauri://drag-drop` event).
 */

import { useEffect, useMemo, useState, type DragEvent, type FC } from 'react';
import { CalendarClock, Check, CloudUpload, HardDrive, Plus, Upload, X } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { vaultDropPaths } from '@/lib/tauri/vault';
import { useVaultStore } from '@/stores/vaultStore';
import { useLabelStore } from '@/stores/labelStore';
import { cn } from '@/lib/utils';
import { LabelSelector } from './tasks/LabelSelector';

type ExpiryPreset = 'day' | 'week' | 'month' | 'custom';

const EXPIRY_PRESETS: Array<{ id: Exclude<ExpiryPreset, 'custom'>; label: string; days: number }> = [
  { id: 'day', label: '1 day', days: 1 },
  { id: 'week', label: '1 week', days: 7 },
  { id: 'month', label: '1 month', days: 30 },
];

export const VaultDropZone: FC = () => {
  const [isOver, setIsOver] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [pendingPaths, setPendingPaths] = useState<string[]>([]);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [preset, setPreset] = useState<ExpiryPreset>('week');
  const [customDate, setCustomDate] = useState(() => toDateTimeInput(addDays(Date.now(), 7)));
  const activeScope = useVaultStore((s) => s.activeScope);
  const syncToCloud = useVaultStore((s) => s.syncToCloud);
  const setSyncToCloud = useVaultStore((s) => s.setSyncToCloud);
  const fetchEntries = useVaultStore((s) => s.fetchEntries);
  const fetchUnsortedCount = useVaultStore((s) => s.fetchUnsortedCount);
  const fetchPendingEmbeddings = useVaultStore((s) => s.fetchPendingEmbeddings);
  const labels = useLabelStore((s) => s.labels);
  const loadLabels = useLabelStore((s) => s.load);

  const stagePaths = (paths: string[]) => {
    if (paths.length === 0) return;
    setPendingPaths(paths);
    setLabelIds([]);
    setPreset('week');
    setCustomDate(toDateTimeInput(addDays(Date.now(), 7)));
    void loadLabels();
  };

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ paths?: string[] }>).detail;
      const paths = detail?.paths ?? [];
      stagePaths(paths);
    };
    window.addEventListener('solo:vault-files-selected', handler);
    return () => window.removeEventListener('solo:vault-files-selected', handler);
    // stagePaths intentionally reads current setters only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadLabels]);

  const expiresAt = useMemo(() => {
    if (preset === 'custom') {
      const ms = new Date(customDate).getTime();
      if (!Number.isFinite(ms)) return null;
      return Math.floor(ms / 1000);
    }
    const selected = EXPIRY_PRESETS.find((item) => item.id === preset);
    return Math.floor(addDays(Date.now(), selected?.days ?? 7) / 1000);
  }, [customDate, preset]);

  const selectedLabels = useMemo(
    () => labelIds.map((id) => labels.get(id)).filter(Boolean),
    [labelIds, labels],
  );
  const expiryValid = expiresAt !== null && expiresAt > Math.floor(Date.now() / 1000);

  const ingestPending = async () => {
    if (pendingPaths.length === 0 || labelIds.length === 0 || !expiryValid || !expiresAt) return;
    setIsBusy(true);
    try {
      await vaultDropPaths(pendingPaths, activeScope, 'project', labelIds, expiresAt, syncToCloud);
      await fetchEntries();
      await fetchUnsortedCount();
      await fetchPendingEmbeddings();
      setPendingPaths([]);
      setLabelIds([]);
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
    stagePaths(paths);
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
        'flex flex-col gap-3 rounded-xl px-4 py-4 transition-[background-color,border-color,transform] duration-200',
        'bg-muted/20 border-2 border-dashed border-border/40',
        isOver && 'bg-primary/10 border-primary/50 scale-[1.01]',
      )}
    >
      {pendingPaths.length === 0 ? (
        <>
          <div className="flex flex-col items-center justify-center gap-3 py-4">
            <Upload
              className={cn(
                'w-7 h-7 transition-colors duration-150',
                isOver ? 'text-primary' : 'text-muted-foreground/50',
              )}
            />
            <p className="text-xs font-medium text-muted-foreground">
              {isBusy
                ? syncToCloud
                  ? 'Indexing and syncing...'
                  : 'Indexing locally...'
                : 'Add files to the vault'}
            </p>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-primary/10 text-primary">
              <Upload className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold">
                {pendingPaths.length} file{pendingPaths.length === 1 ? '' : 's'} selected
              </div>
              <div className="truncate text-[10px] text-muted-foreground/70">
                {pendingPaths[0]}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPendingPaths([])}
              disabled={isBusy}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-muted/65 hover:text-foreground active:scale-[0.96] disabled:opacity-50"
              aria-label="Cancel file capture"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-medium text-muted-foreground">Labels</span>
            <LabelSelector
              selected={labelIds}
              onAdd={(id) => setLabelIds((current) => current.includes(id) ? current : [...current, id])}
              onRemove={(id) => setLabelIds((current) => current.filter((labelId) => labelId !== id))}
            />
          </div>
          {selectedLabels.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {selectedLabels.map((label) => label ? (
                <span key={label.id} className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-[8px] bg-muted/45 px-2 text-[10px] font-medium">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: label.color }}
                  />
                  <span className="truncate">{label.name}</span>
                </span>
              ) : null)}
            </div>
          ) : (
            <div className="rounded-[10px] bg-muted/25 px-2.5 py-2 text-[10px] text-muted-foreground">
              Add at least one shared label.
            </div>
          )}

          <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
            <CalendarClock className="h-3 w-3" />
            Expiry
            <span className="ml-auto text-foreground/80 tabular-nums">
              {expiresAt ? formatExpiry(expiresAt) : 'Required'}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1 rounded-[12px] bg-muted/35 p-1">
            {[...EXPIRY_PRESETS, { id: 'custom' as const, label: 'Custom', days: 0 }].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setPreset(item.id)}
                className={cn(
                  'h-8 rounded-[9px] px-1 text-[10px] font-medium transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.96]',
                  preset === item.id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          {preset === 'custom' ? (
            <input
              type="datetime-local"
              value={customDate}
              min={toDateTimeInput(Date.now() + 60_000)}
              onChange={(event) => setCustomDate(event.target.value)}
              className="h-9 rounded-[10px] bg-muted/35 px-2.5 text-[11px] outline-none transition-[background-color,box-shadow] duration-150 focus:bg-muted/55 focus:ring-1 focus:ring-ring/35"
            />
          ) : null}
        </div>
      )}

      <div
        className="flex h-7 items-center rounded-lg bg-muted/40 p-0.5"
        role="group"
        aria-label="Vault storage mode"
      >
        <button
          type="button"
          onClick={() => setSyncToCloud(true)}
          className={cn(
            'flex h-6 items-center gap-1 rounded-md px-2 text-[10px] font-medium transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.97]',
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
            'flex h-6 items-center gap-1 rounded-md px-2 text-[10px] font-medium transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.97]',
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
      {pendingPaths.length === 0 ? (
        <>
          <button
            type="button"
            onClick={onPick}
            disabled={isBusy}
            className={cn(
              'mx-auto flex h-8 items-center gap-1.5 rounded-lg px-3 text-[11px] font-medium transition-[filter,opacity,transform] duration-150',
              'bg-primary text-primary-foreground hover:brightness-110 active:scale-[0.97]',
              isBusy && 'cursor-not-allowed opacity-60',
            )}
          >
            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
            Pick files...
          </button>
          <p className="mx-auto max-w-[220px] text-center text-[10px] leading-relaxed text-muted-foreground/60">
            Docs, code, images, data; metadata is required before indexing.
          </p>
        </>
      ) : (
        <button
          type="button"
          onClick={() => void ingestPending()}
          disabled={isBusy || labelIds.length === 0 || !expiryValid}
          className={cn(
            'flex h-9 items-center justify-center gap-1.5 rounded-[11px] text-[11px] font-semibold transition-[background-color,filter,opacity,transform] duration-150 active:scale-[0.96]',
            labelIds.length > 0 && expiryValid && !isBusy
              ? 'bg-primary text-primary-foreground hover:brightness-110'
              : 'cursor-not-allowed bg-muted/45 text-muted-foreground/55',
          )}
        >
          <Check className="h-3.5 w-3.5" />
          {isBusy ? 'Indexing...' : 'Save to Vault'}
        </button>
      )}
    </div>
  );
};

function addDays(ms: number, days: number): number {
  return ms + days * 24 * 60 * 60 * 1000;
}

function toDateTimeInput(ms: number): string {
  const date = new Date(ms);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatExpiry(expiresAt: number): string {
  return new Date(expiresAt * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
