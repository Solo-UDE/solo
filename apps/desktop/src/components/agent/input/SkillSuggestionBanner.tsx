/**
 * SkillSuggestionBanner — "This task might benefit from X" banner above the
 * composer. Renders whenever `marketplaceStore.suggestions` is non-empty
 * (driven by `useSkillSuggestions`).
 *
 * Actions:
 *   - Download → install via `marketplaceStore.install`
 *   - View skill → open a read-only preview with source files
 *   - Skip → dismiss for this session
 */

import type { FC } from 'react';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Sparkles, X } from 'lucide-react';
import { useMarketplaceStore } from '@/stores/marketplaceStore';
import { useSkillStore } from '@/stores/skillStore';
import { useFileExplorerStore } from '@/stores/fileExplorerStore';
import { fetchSkillDetail } from '@/lib/tauri/marketplace';
import type { RegistryEntry, SkillDetail } from '@/lib/tauri/marketplace';

export const SkillSuggestionBanner: FC = () => {
  const suggestions = useMarketplaceStore((s) => s.suggestions);
  const install = useMarketplaceStore((s) => s.install);
  const dismiss = useMarketplaceStore((s) => s.dismissSuggestion);
  const reloadInstalled = useSkillStore((s) => s.loadSkills);
  const rootPath = useFileExplorerStore((s) => s.rootPath);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewDetail, setPreviewDetail] = useState<SkillDetail | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Show only the highest-scoring hit — stacked banners would be noisy.
  const top = suggestions[0] ?? null;
  const preview = suggestions.find((s) => s.entry.id === previewId);

  useEffect(() => {
    if (!preview) {
      setPreviewDetail(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }

    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewDetail(null);
    void fetchSkillDetail(preview.entry)
      .then((detail) => {
        if (!cancelled) setPreviewDetail(detail);
      })
      .catch((err: unknown) => {
        if (!cancelled) setPreviewError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [preview]);

  if (!top) return null;

  return (
    <>
      <AnimatePresence>
        <motion.div
          key={top.entry.id}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.18 }}
          className="mx-auto mb-2 max-w-[56rem] px-4"
        >
          <div className="flex items-center gap-2 rounded-[10px] border border-border/60 bg-card/70 px-3 py-2 text-xs">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-400" />
            <div className="min-w-0 flex-1">
              <span className="text-muted-foreground">This task might benefit from </span>
              <span className="font-medium text-foreground">{top.entry.name}</span>
              <span className="text-muted-foreground"> — {top.reason}.</span>
            </div>
            <button
              type="button"
              disabled={busyId === top.entry.id}
              onClick={async () => {
                setBusyId(top.entry.id);
                try {
                  await install(top.entry);
                  if (rootPath) await reloadInstalled(rootPath);
                } finally {
                  setBusyId(null);
                }
              }}
              className="inline-flex min-h-10 items-center rounded-md border border-border/60 bg-card px-3 text-[10px] text-foreground hover:bg-card/80 disabled:opacity-50"
            >
              {busyId === top.entry.id ? 'Downloading…' : 'Download'}
            </button>
            <button
              type="button"
              onClick={() => setPreviewId(top.entry.id)}
              className="inline-flex min-h-10 items-center rounded-md border border-border/60 bg-card/60 px-3 text-[10px] text-muted-foreground hover:text-foreground"
            >
              View skill
            </button>
            <button
              type="button"
              aria-label="Skip"
              onClick={() => dismiss(top.entry.id)}
              className="grid size-10 place-items-center rounded-md text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </motion.div>
      </AnimatePresence>

      {preview && (
        <SkillPreviewModal
          entry={preview.entry}
          detail={previewDetail}
          error={previewError}
          loading={previewLoading}
          onClose={() => setPreviewId(null)}
          onInstall={async () => {
            setBusyId(preview.entry.id);
            try {
              await install(preview.entry);
              if (rootPath) await reloadInstalled(rootPath);
              setPreviewId(null);
            } finally {
              setBusyId(null);
            }
          }}
        />
      )}
    </>
  );
};

interface PreviewProps {
  entry: RegistryEntry;
  detail: SkillDetail | null;
  error: string | null;
  loading: boolean;
  onClose: () => void;
  onInstall: () => void;
}

const SkillPreviewModal: FC<PreviewProps> = ({ entry, detail, error, loading, onClose, onInstall }) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    onClick={onClose}
  >
    <div
      className="w-[min(640px,92vw)] rounded-[14px] border border-border/70 bg-card p-5 text-sm shadow-[0_20px_60px_-20px_rgba(0,0,0,0.5)]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">{entry.name}</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {entry.source} · <span className="tabular-nums">{entry.installs.toLocaleString()}</span> installs
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid size-10 place-items-center rounded-md text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {loading && <p className="mb-4 text-xs text-muted-foreground">Loading preview…</p>}
      {error && (
        <p className="mb-4 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs leading-5 text-red-400">
          {error}
        </p>
      )}
      <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
        {detail?.description || entry.description || 'No description available.'}
      </p>
      {detail && detail.files.length > 0 && (
        <div className="mb-4 max-h-40 overflow-y-auto rounded-md border border-border/60 bg-background/40">
          {detail.files.map((file) => (
            <div
              key={file.path}
              className="flex items-center justify-between gap-3 border-b border-border/50 px-3 py-2 text-[10px] last:border-b-0"
            >
              <span className="min-w-0 truncate text-foreground">{file.path}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{file.bytes.toLocaleString()} B</span>
            </div>
          ))}
        </div>
      )}
      {detail && !detail.installable && (
        <div className="rounded-md border border-border/60 bg-background/40 p-2 text-[10px] leading-4 text-muted-foreground">
          {detail.install_note}
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex min-h-10 items-center rounded-md border border-border/60 bg-card/60 px-3 text-xs hover:bg-card/80"
        >
          Close
        </button>
        <button
          type="button"
          disabled={detail ? !detail.installable : false}
          onClick={onInstall}
          className="inline-flex min-h-10 items-center rounded-md border border-border/60 bg-foreground/90 px-3 text-xs text-background hover:bg-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          Install
        </button>
      </div>
    </div>
  </div>
);
