/**
 * VaultEntryDrawer — details / edit surface for a single entry.
 *
 * Slides in from the right edge of the vault panel with:
 *   - Full metadata (title, subkind, mime, size, created/updated, hits)
 *   - Tag editor (add/remove; calls `vault_update_tags`)
 *   - Scope toggle (Global ↔ Project; calls `vault_move_scope`)
 *   - Pin toggle (mirrors the card; calls `vault_set_pinned`)
 *   - Delete with confirmation (calls `vault_delete`)
 *
 * State management:
 *   - Which entry is open lives in `vaultStore.selectedEntryId`.
 *   - Tag edits are local until Enter is pressed, then committed.
 *   - Scope and pin changes commit immediately (optimistic UI).
 *   - Delete requires two clicks (visible "Confirm delete?" state).
 */

import { useEffect, useMemo, useRef, useState, type FC, type KeyboardEvent } from 'react';
import {
  X,
  Pin,
  Trash2,
  Tag,
  Plus,
  Folders,
  Globe,
  Database,
  Copy,
  CloudCheck,
  CloudOff,
  CloudUpload,
  AlertCircle,
  CalendarClock,
} from 'lucide-react';
import type { VaultEntry, VaultScope } from '@/lib/tauri/vault';
import {
  vaultDelete,
  vaultSetPinned,
  vaultUpdateLabelsAndExpiry,
  vaultUpdateTags,
  vaultMoveScope,
} from '@/lib/tauri/vault';
import { useVaultStore } from '@/stores/vaultStore';
import { useLabelStore } from '@/stores/labelStore';
import { cn } from '@/lib/utils';
import { LabelSelector } from './tasks/LabelSelector';

interface Props {
  entry: VaultEntry;
  onClose: () => void;
}

export const VaultEntryDrawer: FC<Props> = ({ entry, onClose }) => {
  const upsertEntry = useVaultStore((s) => s.upsertEntry);
  const removeEntry = useVaultStore((s) => s.removeEntry);
  const syncEntry = useVaultStore((s) => s.syncEntry);
  const fetchUnsortedCount = useVaultStore((s) => s.fetchUnsortedCount);
  const labels = useLabelStore((s) => s.labels);
  const loadLabels = useLabelStore((s) => s.load);

  const [tagInput, setTagInput] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const deleteRemote = entry.cloud_sync_state !== 'offline';
  const canSyncCloud = entry.cloud_sync_state !== 'synced';
  const expiresAt = toOptionalNumber(entry.expires_at);
  const expired = expiresAt !== null && expiresAt <= Math.floor(Date.now() / 1000);

  // Close on Esc. Local keydown is cheaper than a global listener.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmDelete && tagInput === '') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, confirmDelete, tagInput]);

  useEffect(() => {
    void loadLabels();
  }, [loadLabels]);

  const updateLabelsAndExpiry = async (nextLabelIds: string[], nextExpiresAt: number | null) => {
    setBusy(true);
    try {
      const updated = await vaultUpdateLabelsAndExpiry(entry.id, nextLabelIds, nextExpiresAt);
      if (updated) upsertEntry(updated);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[vault] update labels/expiry failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const addLabel = async (labelId: string) => {
    const current = entry.label_ids ?? [];
    if (current.includes(labelId)) return;
    await updateLabelsAndExpiry([...current, labelId], expiresAt);
  };

  const removeLabel = async (labelId: string) => {
    await updateLabelsAndExpiry((entry.label_ids ?? []).filter((id) => id !== labelId), expiresAt);
  };

  const renew = async (days: number) => {
    const next = Math.floor(Date.now() / 1000) + days * 24 * 60 * 60;
    await updateLabelsAndExpiry(entry.label_ids ?? [], next);
  };

  const addTag = async (raw: string) => {
    const tag = raw.trim().replace(/,$/, '').replace(/\s+/g, '-').toLowerCase();
    if (!tag) return;
    if (entry.tags.includes(tag)) {
      setTagInput('');
      return;
    }
    setBusy(true);
    try {
      const next = [...entry.tags, tag];
      const updated = await vaultUpdateTags(entry.id, next);
      if (updated) upsertEntry(updated);
      setTagInput('');
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[vault] add tag failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const removeTag = async (tag: string) => {
    setBusy(true);
    try {
      const next = entry.tags.filter((t) => t !== tag);
      const updated = await vaultUpdateTags(entry.id, next);
      if (updated) upsertEntry(updated);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[vault] remove tag failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const togglePin = async () => {
    setBusy(true);
    try {
      const updated = await vaultSetPinned(entry.id, !entry.pinned);
      if (updated) upsertEntry(updated);
    } finally {
      setBusy(false);
    }
  };

  const toggleScope = async () => {
    setBusy(true);
    try {
      // V1.3: we only expose Global ↔ Project-with-current-project toggle.
      // Precise project_id is the currently-active scope's project_id when
      // moving *to* project, else we fall back to the app cwd.
      const currentScope = useVaultStore.getState().activeScope;
      const next: VaultScope =
        entry.scope.type === 'global'
          ? currentScope.type === 'project'
            ? { type: 'project', project_id: currentScope.project_id }
            : { type: 'project', project_id: 'default' }
          : { type: 'global' };
      const updated = await vaultMoveScope(entry.id, next);
      if (updated) upsertEntry(updated);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[vault] scope toggle failed:', err);
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    try {
      await vaultDelete(entry.id, deleteRemote);
      removeEntry(entry.id);
      await fetchUnsortedCount();
      onClose();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[vault] delete failed:', err);
      setBusy(false);
    }
  };

  const onSyncCloud = async () => {
    if (!canSyncCloud || isSyncingCloud) return;
    setIsSyncingCloud(true);
    try {
      await syncEntry(entry.id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[vault] cloud sync failed:', err);
    } finally {
      setIsSyncingCloud(false);
    }
  };

  const onTagKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      void addTag(tagInput);
    } else if (e.key === 'Backspace' && tagInput === '' && entry.tags.length > 0) {
      // Pop the last tag on backspace when input is empty (standard chip UX).
      void removeTag(entry.tags[entry.tags.length - 1]);
    }
  };

  const copyPath = async () => {
    const p = entry.source_path ?? entry.vault_blob_path;
    if (!p) return;
    try {
      await navigator.clipboard.writeText(p);
    } catch {
      /* clipboard may be unavailable */
    }
  };

  const formattedSize = useMemo(() => formatBytes(entry.size_bytes), [entry.size_bytes]);
  const formattedCreated = useMemo(() => formatRelative(entry.created_at), [entry.created_at]);
  const formattedUpdated = useMemo(() => formatRelative(entry.updated_at), [entry.updated_at]);

  return (
    <div
      className="absolute inset-0 z-30 flex flex-col bg-background/95 backdrop-blur-md"
      role="dialog"
      aria-label={`Entry details for ${entry.title}`}
    >
      {/* Header */}
      <div className="px-3 pt-3 pb-2 flex items-center gap-2 shrink-0 border-b border-border/30">
        <button
          type="button"
          onClick={onClose}
          className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors duration-150"
          aria-label="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
        <span className="text-xs font-medium truncate flex-1">{entry.title}</span>

        <button
          type="button"
          onClick={() => void togglePin()}
          disabled={busy}
          className={cn(
            'h-6 px-2 rounded-md flex items-center gap-1 text-[10px] font-medium transition-[background-color,color,box-shadow,opacity,transform] duration-150 active:scale-[0.97]',
            entry.pinned
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-muted/60',
          )}
          title={entry.pinned ? 'Unpin' : 'Pin as source of truth'}
        >
          <Pin className={cn('w-3 h-3', entry.pinned && 'fill-current')} />
          {entry.pinned ? 'Pinned' : 'Pin'}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-3 py-3 flex flex-col gap-4">
        {/* Metadata grid */}
        <section className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[10px]">
          <MetaRow label="Kind" value={kindLabel(entry.kind, entry.subkind)} />
          {entry.mime && <MetaRow label="MIME" value={entry.mime} mono />}
          {formattedSize && <MetaRow label="Size" value={formattedSize} />}
          <MetaRow label="Added" value={formattedCreated} />
          <MetaRow label="Updated" value={formattedUpdated} />
          <MetaRow
            label="Retrievals"
            value={`${entry.retrieval_stats.hit_count}${
              entry.retrieval_stats.last_retrieved_at
                ? ` · last ${formatRelative(entry.retrieval_stats.last_retrieved_at)}`
                : ''
            }`}
          />
          {entry.source_path && (
            <MetaRow label="Source" value={entry.source_path} mono copyable onCopy={copyPath} />
          )}
        </section>

        {/* Scope toggle */}
        <section className="flex flex-col gap-1.5">
          <div className="text-[10px] text-muted-foreground/80 font-medium">Scope</div>
          <div className="flex items-center gap-1.5">
            <ScopePill active={entry.scope.type === 'global'}>
              <Globe className="w-3 h-3" />
              Global
            </ScopePill>
            <span className="text-muted-foreground/40 text-[10px]">↔</span>
            <ScopePill active={entry.scope.type === 'project'}>
              <Folders className="w-3 h-3" />
              {entry.scope.type === 'project' ? entry.scope.project_id : 'Project'}
            </ScopePill>
            <button
              type="button"
              onClick={() => void toggleScope()}
              disabled={busy}
              className="ml-auto h-6 px-2 rounded-md text-[10px] font-medium bg-muted/40 hover:bg-muted/60 transition-[background-color,color,box-shadow,opacity,transform] duration-150 active:scale-[0.97] disabled:opacity-50"
            >
              Swap
            </button>
          </div>
        </section>

        {/* Shared labels */}
        <section className="flex flex-col gap-1.5">
          <div className="text-[10px] text-muted-foreground/80 font-medium flex items-center justify-between">
            <span className="flex items-center gap-1">
              <Tag className="w-3 h-3" /> Labels
            </span>
            <LabelSelector
              selected={entry.label_ids ?? []}
              onAdd={addLabel}
              onRemove={removeLabel}
              compact
            />
          </div>
          {(entry.label_ids ?? []).length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {(entry.label_ids ?? []).map((labelId) => {
                const label = labels.get(labelId);
                return (
                  <button
                    key={labelId}
                    type="button"
                    onClick={() => void removeLabel(labelId)}
                    disabled={busy}
                    className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-md bg-muted/35 px-2 text-[10px] font-medium transition-[background-color,color] duration-150 hover:bg-muted/60 disabled:opacity-50"
                    title="Remove label"
                  >
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: label?.color ?? '#64748b' }}
                    />
                    <span className="truncate">{label?.name ?? labelId}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg bg-muted/25 px-2 py-1.5 text-[10px] text-muted-foreground">
              No labels yet
            </div>
          )}
        </section>

        {/* Expiry */}
        <section className="flex flex-col gap-1.5">
          <div className="text-[10px] text-muted-foreground/80 font-medium flex items-center gap-1">
            <CalendarClock className="w-3 h-3" /> Expiry
          </div>
          <div
            className={cn(
              'rounded-lg px-2 py-1.5 text-[10px] font-medium',
              expired
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-300'
                : 'bg-muted/30 text-foreground/85',
            )}
          >
            {expiresAt === null
              ? 'Legacy active entry'
              : expired
                ? `Expired ${formatExpiryDate(expiresAt)}`
                : `Active until ${formatExpiryDate(expiresAt)}`}
          </div>
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => void renew(7)}
              disabled={busy}
              className="h-7 rounded-md bg-muted/35 text-[10px] font-medium text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-muted/60 hover:text-foreground active:scale-[0.97] disabled:opacity-50"
            >
              Renew 1 week
            </button>
            <button
              type="button"
              onClick={() => void renew(30)}
              disabled={busy}
              className="h-7 rounded-md bg-muted/35 text-[10px] font-medium text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-muted/60 hover:text-foreground active:scale-[0.97] disabled:opacity-50"
            >
              Renew 1 month
            </button>
          </div>
        </section>

        {/* Tag editor */}
        <section className="flex flex-col gap-1.5">
          <div className="text-[10px] text-muted-foreground/80 font-medium flex items-center gap-1">
            <Tag className="w-3 h-3" /> Tags
          </div>
          <div
            className="flex flex-wrap gap-1 min-h-[28px] p-1.5 rounded-lg bg-muted/30 cursor-text ring-1 ring-transparent focus-within:ring-ring/40 transition-[background-color,color,box-shadow,opacity,transform] duration-150"
            onClick={() => tagInputRef.current?.focus()}
          >
            {entry.tags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => void removeTag(t)}
                disabled={busy}
                className="group flex items-center gap-1 h-5 px-1.5 rounded-md bg-background text-[10px] font-medium shadow-xs hover:bg-destructive/10 hover:text-destructive transition-colors duration-150"
                title="Remove tag"
              >
                {t}
                <X className="w-2.5 h-2.5 opacity-40 group-hover:opacity-100" />
              </button>
            ))}
            <input
              ref={tagInputRef}
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={onTagKey}
              placeholder={entry.tags.length === 0 ? 'Add tags (press Enter)…' : ''}
              disabled={busy}
              className="flex-1 min-w-[80px] h-5 px-1 bg-transparent text-[10px] focus:outline-none placeholder:text-muted-foreground/50"
            />
          </div>
          {tagInput.trim() && (
            <button
              type="button"
              onClick={() => void addTag(tagInput)}
              className="self-start h-6 px-2 rounded-md flex items-center gap-1 text-[10px] bg-primary/10 text-primary hover:bg-primary/15 transition-colors duration-150"
            >
              <Plus className="w-3 h-3" />
              Add &quot;{tagInput.trim()}&quot;
            </button>
          )}
        </section>

        {/* Index status */}
        <section className="flex flex-col gap-1.5">
          <div className="text-[10px] text-muted-foreground/80 font-medium flex items-center gap-1">
            <Database className="w-3 h-3" /> Index
          </div>
          <div className="text-[10px] text-muted-foreground">
            Status: <span className="font-medium text-foreground">{entry.index_status}</span>
            {entry.classifier_confidence > 0 && (
              <span>
                {' '}
                · classifier {Math.round(entry.classifier_confidence * 100)}%
              </span>
            )}
          </div>
        </section>

        {/* Cloud status */}
        <section className="flex flex-col gap-1.5">
          <div className="text-[10px] text-muted-foreground/80 font-medium flex items-center gap-1">
            <CloudStatusIcon state={entry.cloud_sync_state} syncing={isSyncingCloud} />
            Cloud
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <span>
              Status:{' '}
              <span className="font-medium text-foreground">
                {cloudStatusLabel(entry.cloud_sync_state)}
              </span>
            </span>
            {canSyncCloud && (
              <button
                type="button"
                onClick={() => void onSyncCloud()}
                disabled={isSyncingCloud}
                className="ml-auto h-6 px-2 rounded-md flex items-center gap-1 text-[10px] font-medium bg-primary/10 text-primary hover:bg-primary/15 transition-[background-color,color,box-shadow,opacity,transform] duration-150 active:scale-[0.97] disabled:opacity-60"
              >
                <CloudUpload className="w-3 h-3" />
                {entry.cloud_sync_state === 'failed'
                  ? 'Retry sync'
                  : entry.cloud_sync_state === 'offline'
                    ? 'Sync'
                    : 'Refresh'}
              </button>
            )}
          </div>
        </section>
      </div>

      {/* Danger zone */}
      <div className="px-3 py-2 border-t border-border/30 shrink-0">
        <button
          type="button"
          onClick={() => void onDelete()}
          disabled={busy}
          className={cn(
            'w-full h-8 rounded-lg flex items-center justify-center gap-1.5 text-[11px] font-medium transition-[background-color,color,box-shadow,opacity,transform] duration-150 active:scale-[0.98]',
            confirmDelete
              ? 'bg-destructive text-destructive-foreground hover:brightness-110'
              : 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
            busy && 'opacity-50 cursor-not-allowed',
          )}
        >
          <Trash2 className={cn('w-3.5 h-3.5', confirmDelete && 'fill-current')} />
          {confirmDelete
            ? deleteRemote
              ? 'Click again to delete everywhere'
              : 'Click again to confirm delete'
            : deleteRemote
              ? 'Delete everywhere'
              : 'Delete entry'}
        </button>
        {confirmDelete && (
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            className="mt-1 w-full h-6 text-[10px] text-muted-foreground hover:text-foreground transition-colors duration-150"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
};

const CloudStatusIcon: FC<{ state: VaultEntry['cloud_sync_state']; syncing: boolean }> = ({
  state,
  syncing,
}) => {
  const className = cn(
    'w-3 h-3',
    state === 'synced' && 'text-primary',
    (state === 'pending' || state === 'uploading' || state === 'indexing_remote') &&
      'text-primary/70',
    state === 'failed' && 'text-destructive',
    state === 'offline' && 'text-muted-foreground/60',
    syncing && 'animate-pulse',
  );

  if (state === 'synced') return <CloudCheck className={className} />;
  if (state === 'failed') return <AlertCircle className={className} />;
  if (state === 'offline') return <CloudOff className={className} />;
  return <CloudUpload className={className} />;
};

const cloudStatusLabel = (state: VaultEntry['cloud_sync_state']) => {
  switch (state) {
    case 'offline':
      return 'local only';
    case 'pending':
      return 'queued';
    case 'uploading':
      return 'uploading';
    case 'indexing_remote':
      return 'indexing';
    case 'synced':
      return 'synced';
    case 'failed':
      return 'failed';
  }
};

const MetaRow: FC<{
  label: string;
  value: string;
  mono?: boolean;
  copyable?: boolean;
  onCopy?: () => void;
}> = ({ label, value, mono, copyable, onCopy }) => (
  <>
    <div className="text-muted-foreground/70 font-medium">{label}</div>
    <div
      className={cn(
        'truncate text-foreground/90 flex items-center gap-1',
        mono && 'font-mono',
      )}
      title={value}
    >
      <span className="truncate">{value}</span>
      {copyable && (
        <button
          type="button"
          onClick={onCopy}
          className="shrink-0 w-4 h-4 rounded-sm flex items-center justify-center text-muted-foreground/60 hover:text-foreground hover:bg-muted/60 transition-colors duration-150"
          title="Copy"
        >
          <Copy className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  </>
);

const ScopePill: FC<{ active: boolean; children: React.ReactNode }> = ({ active, children }) => (
  <div
    className={cn(
      'h-6 px-2 rounded-md flex items-center gap-1 text-[10px] font-medium transition-colors duration-150',
      active
        ? 'bg-primary/10 text-primary ring-1 ring-inset ring-primary/20'
        : 'bg-muted/30 text-muted-foreground/60',
    )}
  >
    {children}
  </div>
);

function kindLabel(kind: string, subkind: string | null): string {
  if (subkind) return `${kind} · ${subkind}`;
  return kind;
}

function formatBytes(bytes: number | bigint | null): string | null {
  if (bytes == null) return null;
  const n = typeof bytes === 'bigint' ? Number(bytes) : bytes;
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let size = n;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(size >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function formatRelative(unixSeconds: number | bigint): string {
  const secs = typeof unixSeconds === 'bigint' ? Number(unixSeconds) : unixSeconds;
  if (!Number.isFinite(secs) || secs <= 0) return '—';
  const diff = Date.now() / 1000 - secs;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.round(diff / 86400)}d ago`;
  const d = new Date(secs * 1000);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function toOptionalNumber(value: number | bigint | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'bigint' ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

function formatExpiryDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
