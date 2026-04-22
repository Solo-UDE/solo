import { useState, type FC } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { GitMerge, Trash2, GitPullRequest, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/taskStore';

export const ReviewModal: FC = () => {
  const review = useTaskStore((s) => s.pendingReview);
  const merge = useTaskStore((s) => s.reviewMerge);
  const discard = useTaskStore((s) => s.reviewDiscard);
  const openPr = useTaskStore((s) => s.reviewOpenPr);
  const close = useTaskStore((s) => s.closeReview);

  const [busy, setBusy] = useState<null | 'merge' | 'discard' | 'pr'>(null);

  const run = async (action: 'merge' | 'discard' | 'pr') => {
    setBusy(action);
    try {
      if (action === 'merge') {
        const branch = await merge();
        if (branch) {
          alert(`Worktree promoted to branch: ${branch}\n\nRun 'git merge ${branch}' in your terminal to merge into main.`);
        }
      } else if (action === 'discard') {
        await discard();
      } else {
        const url = await openPr();
        if (url) window.open(url, '_blank');
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <AnimatePresence>
      {review && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-center bg-background/60 backdrop-blur-sm"
          onClick={close}
        >
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-[14px] border border-border/60 bg-card p-5 shadow-lg"
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-[14px] font-semibold">Task run ready for review</h2>
                <p className="mt-1 text-[12px] text-muted-foreground">{review.diffSummary}</p>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Worktree: <code className="rounded bg-muted/40 px-1">{review.worktreeId}</code>
                </p>
              </div>
              <button
                type="button" onClick={close} aria-label="Close"
                className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted/50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 flex flex-col gap-2">
              <Action icon={GitMerge}         label="Merge to main"   onClick={() => run('merge')}   busy={busy==='merge'}   tone="ok"/>
              <Action icon={GitPullRequest}   label="Open pull request" onClick={() => run('pr')}      busy={busy==='pr'}     tone="neutral"/>
              <Action icon={Trash2}           label="Discard changes" onClick={() => run('discard')} busy={busy==='discard'} tone="danger"/>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const Action: FC<{
  icon: React.ComponentType<{ className?: string }>,
  label: string,
  onClick: () => void,
  busy: boolean,
  tone: 'ok' | 'neutral' | 'danger',
}> = ({ icon: Icon, label, onClick, busy, tone }) => (
  <button
    type="button"
    disabled={busy}
    onClick={onClick}
    className={cn(
      'flex items-center gap-2 rounded-md border px-3 py-2 text-[13px] font-medium',
      'hover:bg-muted/60 disabled:opacity-50',
      tone === 'ok'     && 'border-green-500/40 text-green-600',
      tone === 'neutral'&& 'border-border/60 text-foreground',
      tone === 'danger' && 'border-red-500/40 text-red-600',
    )}
  >
    <Icon className="h-4 w-4" />
    <span>{label}</span>
    {busy && <span className="ml-auto text-[10px] text-muted-foreground">running…</span>}
  </button>
);
