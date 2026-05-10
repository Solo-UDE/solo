import { useEffect, useMemo, useState, type FC, type ReactNode } from 'react';
import {
  Archive,
  CalendarClock,
  Check,
  CloudUpload,
  FolderOpen,
  Globe,
  HardDrive,
  X,
} from 'lucide-react';

import { LabelSelector } from '@/components/vault/tasks/LabelSelector';
import { useFileExplorerStore } from '@/stores/fileExplorerStore';
import { useLabelStore } from '@/stores/labelStore';
import { cn } from '@/lib/utils';

import type { MemoryType, VaultScope } from '@/lib/tauri/vault';

export interface VaultCaptureDraft {
  text: string;
  title: string;
}

interface VaultCaptureSavePayload {
  labelIds: string[];
  expiresAt: number;
  scope: VaultScope;
  memoryType: MemoryType;
  syncToCloud: boolean;
}

interface Props {
  draft: VaultCaptureDraft | null;
  defaultScope: VaultScope;
  defaultSyncToCloud: boolean;
  onSave: (payload: VaultCaptureSavePayload) => Promise<void>;
  onCancel: () => void;
}

type ExpiryPreset = 'day' | 'week' | 'month' | 'custom';

const EXPIRY_PRESETS: Array<{ id: Exclude<ExpiryPreset, 'custom'>; label: string; days: number }> = [
  { id: 'day', label: '1 day', days: 1 },
  { id: 'week', label: '1 week', days: 7 },
  { id: 'month', label: '1 month', days: 30 },
];

export const VaultCapturePanel: FC<Props> = ({
  draft,
  defaultScope,
  defaultSyncToCloud,
  onSave,
  onCancel,
}) => {
  const labels = useLabelStore((s) => s.labels);
  const loadLabels = useLabelStore((s) => s.load);
  const rootPath = useFileExplorerStore((s) => s.rootPath);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [preset, setPreset] = useState<ExpiryPreset>('week');
  const [customDate, setCustomDate] = useState(() => toDateTimeInput(addDays(Date.now(), 7)));
  const [scope, setScope] = useState<VaultScope>(defaultScope);
  const [syncToCloud, setSyncToCloud] = useState(defaultSyncToCloud);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!draft) return;
    setLabelIds([]);
    setPreset('week');
    setCustomDate(toDateTimeInput(addDays(Date.now(), 7)));
    setScope(defaultScope);
    setSyncToCloud(defaultSyncToCloud);
    setIsSaving(false);
    setError(null);
    void loadLabels();
  }, [defaultScope, defaultSyncToCloud, draft, loadLabels]);

  const expiresAt = useMemo(() => {
    if (preset === 'custom') {
      const ms = new Date(customDate).getTime();
      if (!Number.isFinite(ms)) return null;
      return Math.floor(ms / 1000);
    }
    const selected = EXPIRY_PRESETS.find((item) => item.id === preset);
    return Math.floor(addDays(Date.now(), selected?.days ?? 7) / 1000);
  }, [customDate, preset]);

  const expiryLabel = useMemo(() => {
    if (!expiresAt) return 'No expiry selected';
    return new Date(expiresAt * 1000).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }, [expiresAt]);

  const selectedLabels = useMemo(
    () => labelIds.map((id) => labels.get(id)).filter(Boolean),
    [labelIds, labels],
  );

  if (!draft) return null;

  const hasProject = Boolean(rootPath || defaultScope.type === 'project');
  const projectScope: VaultScope =
    defaultScope.type === 'project'
      ? defaultScope
      : { type: 'project', project_id: rootPath ?? 'default' };
  const expiryValid = expiresAt !== null && expiresAt > Math.floor(Date.now() / 1000);
  const canSave = labelIds.length > 0 && expiryValid && !isSaving;

  const addLabel = (labelId: string) => {
    setLabelIds((current) => current.includes(labelId) ? current : [...current, labelId]);
  };

  const removeLabel = (labelId: string) => {
    setLabelIds((current) => current.filter((id) => id !== labelId));
  };

  const save = async () => {
    if (!canSave || !expiresAt) return;
    setIsSaving(true);
    setError(null);
    try {
      await onSave({
        labelIds,
        expiresAt,
        scope,
        memoryType: scope.type === 'project' ? 'project' : 'user',
        syncToCloud,
      });
    } catch (err) {
      setError('Could not save to Vault');
      setIsSaving(false);
      // eslint-disable-next-line no-console
      console.error('[vault] chat capture failed:', err);
    }
  };

  return (
    <aside
      className="absolute right-3 top-16 z-30 flex w-[min(330px,calc(100%-1.5rem))] flex-col rounded-[18px] bg-card/96 p-3 text-card-foreground shadow-[0_24px_70px_-38px_rgba(0,0,0,0.78),0_0_0_1px_rgba(255,255,255,0.08)] backdrop-blur-xl lg:right-4 lg:w-[330px]"
      role="dialog"
      aria-label="Vault capture"
    >
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-primary/10 text-primary">
          <Archive className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold">Add to Vault</div>
          <div className="text-[11px] text-muted-foreground">Labels and expiry required</div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="flex h-10 w-10 items-center justify-center rounded-[12px] text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-muted/60 hover:text-foreground active:scale-[0.96]"
          aria-label="Cancel Vault capture"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 rounded-[12px] bg-muted/35 p-2.5">
        <div className="line-clamp-5 text-[11px] leading-relaxed text-foreground/86">
          {draft.text}
        </div>
      </div>

      <section className="mt-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground">Labels</span>
          <LabelSelector
            selected={labelIds}
            onAdd={addLabel}
            onRemove={removeLabel}
          />
        </div>
        {selectedLabels.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {selectedLabels.map((label) => label ? (
              <button
                key={label.id}
                type="button"
                onClick={() => removeLabel(label.id)}
                className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-[8px] bg-muted/45 px-2 text-[11px] font-medium text-foreground transition-[background-color,color,transform] duration-150 hover:bg-muted active:scale-[0.96]"
                title="Remove label"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: label.color }}
                  aria-hidden="true"
                />
                <span className="truncate">{label.name}</span>
              </button>
            ) : null)}
          </div>
        ) : (
          <div className="rounded-[10px] bg-muted/25 px-2.5 py-2 text-[11px] text-muted-foreground">
            Choose or create at least one idea label.
          </div>
        )}
      </section>

      <section className="mt-3 flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <CalendarClock className="h-3.5 w-3.5" />
          Expiry
          <span className="ml-auto font-normal tabular-nums text-foreground/80">{expiryLabel}</span>
        </div>
        <div className="grid grid-cols-4 gap-1 rounded-[12px] bg-muted/35 p-1">
          {[...EXPIRY_PRESETS, { id: 'custom' as const, label: 'Custom', days: 0 }].map((item) => {
            const active = preset === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setPreset(item.id)}
                className={cn(
                  'h-9 rounded-[9px] px-1 text-[11px] font-medium transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.96]',
                  active
                    ? 'bg-background text-foreground shadow-[0_8px_22px_-16px_rgba(0,0,0,0.55)]'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        {preset === 'custom' ? (
          <input
            type="datetime-local"
            value={customDate}
            min={toDateTimeInput(Date.now() + 60_000)}
            onChange={(event) => setCustomDate(event.target.value)}
            className="h-10 rounded-[10px] bg-muted/35 px-2.5 text-[12px] text-foreground outline-none transition-[background-color,box-shadow] duration-150 focus:bg-muted/55 focus:ring-1 focus:ring-ring/35"
          />
        ) : null}
      </section>

      <section className="mt-3 grid grid-cols-2 gap-2">
        <Segment
          active={scope.type === 'global'}
          icon={<Globe className="h-3.5 w-3.5" />}
          label="Global"
          onClick={() => setScope({ type: 'global' })}
        />
        <Segment
          active={scope.type === 'project'}
          icon={<FolderOpen className="h-3.5 w-3.5" />}
          label="Project"
          disabled={!hasProject}
          onClick={() => setScope(projectScope)}
        />
      </section>

      <section className="mt-2 grid grid-cols-2 gap-2">
        <Segment
          active={syncToCloud}
          icon={<CloudUpload className="h-3.5 w-3.5" />}
          label="Cloud"
          onClick={() => setSyncToCloud(true)}
        />
        <Segment
          active={!syncToCloud}
          icon={<HardDrive className="h-3.5 w-3.5" />}
          label="Local"
          onClick={() => setSyncToCloud(false)}
        />
      </section>

      {error ? (
        <div className="mt-3 rounded-[10px] bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive" role="status">
          {error}
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-10 flex-1 rounded-[12px] bg-muted/35 text-[12px] font-medium text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-muted/55 hover:text-foreground active:scale-[0.96]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canSave}
          className={cn(
            'h-10 flex-1 rounded-[12px] text-[12px] font-semibold transition-[background-color,filter,opacity,transform] duration-150 active:scale-[0.96]',
            canSave
              ? 'bg-primary text-primary-foreground hover:brightness-110'
              : 'cursor-not-allowed bg-muted/45 text-muted-foreground/55',
          )}
        >
          <span className="inline-flex items-center justify-center gap-1.5">
            <Check className="h-3.5 w-3.5" />
            {isSaving ? 'Saving' : 'Save'}
          </span>
        </button>
      </div>
    </aside>
  );
};

const Segment: FC<{
  active: boolean;
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}> = ({ active, icon, label, disabled = false, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={cn(
      'flex h-10 items-center justify-center gap-1.5 rounded-[12px] text-[11px] font-medium transition-[background-color,color,box-shadow,opacity,transform] duration-150 active:scale-[0.96]',
      active
        ? 'bg-muted text-foreground shadow-[0_8px_22px_-18px_rgba(0,0,0,0.65)]'
        : 'bg-muted/30 text-muted-foreground hover:bg-muted/45 hover:text-foreground',
      disabled && 'cursor-not-allowed opacity-45',
    )}
  >
    {icon}
    {label}
  </button>
);

function addDays(ms: number, days: number): number {
  return ms + days * 24 * 60 * 60 * 1000;
}

function toDateTimeInput(ms: number): string {
  const date = new Date(ms);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
