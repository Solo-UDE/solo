import { useState, type FC, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/taskStore';

const SOURCES = [
  { id: 'vault',  label: 'Vault entries' },
  { id: 'skills', label: 'Skills' },
  { id: 'git',    label: 'Git state' },
  { id: 'tasks',  label: 'Existing tasks' },
] as const;

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
}

export const NewPlanDialog: FC<Props> = ({ open, onClose }) => {
  const planFromGoal = useTaskStore((s) => s.planFromGoal);
  const [goal, setGoal] = useState('');
  const [bundle, setBundle] = useState<readonly string[]>(() => SOURCES.map((s) => s.id));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!goal.trim()) return;
    setBusy(true); setErr(null);
    try {
      const ids = await planFromGoal(goal.trim(), bundle as string[]);
      if (ids.length === 0) setErr('Planner returned no drafts. Try a more specific goal.');
      else { setGoal(''); onClose(); }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) => {
    setBundle((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-center bg-background/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.form
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={onSubmit}
            className="flex w-full max-w-lg flex-col gap-4 rounded-[14px] border border-border/40 bg-card/95 backdrop-blur-md p-5 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.2)]"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-foreground" />
              <h2 className="text-[14px] font-semibold">Plan from goal</h2>
            </div>

            <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
              Goal
              <textarea
                autoFocus
                wrap="soft"
                rows={3}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="e.g. Prep for the demo this Friday — slides, rehearsal, backup plan"
                className="resize-none overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words rounded-[10px] border border-border/40 bg-muted/40 px-2 py-1.5 text-[13px] text-foreground focus:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none transition-all duration-200"
              />
            </label>

            <fieldset className="flex flex-col gap-1">
              <legend className="text-[11px] font-medium text-muted-foreground">Context sources</legend>
              <div className="flex flex-wrap gap-2 pt-1">
                {SOURCES.map((s) => (
                  <label key={s.id} className={cn(
                    'flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-border/40 px-2.5 py-1 text-[12px] transition-all duration-200',
                    bundle.includes(s.id) ? 'bg-card' : 'bg-background text-muted-foreground',
                  )}>
                    <input
                      type="checkbox"
                      checked={bundle.includes(s.id)}
                      onChange={() => toggle(s.id)}
                      className="accent-foreground"
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            </fieldset>

            {err && <div className="text-[12px] text-red-500">{err}</div>}

            <div className="flex justify-end gap-2">
              <button
                type="button" onClick={onClose} disabled={busy}
                className="h-9 rounded-[10px] border border-border/40 bg-background px-3 text-[12px] hover:bg-muted/60 active:scale-[0.97] transition-all duration-200"
              >Cancel</button>
              <button
                type="submit" disabled={busy || !goal.trim()}
                className={cn(
                  'flex h-9 items-center gap-1.5 rounded-[10px] bg-foreground px-3 text-[12px] font-medium text-background',
                  'active:scale-[0.97] transition-all duration-200 disabled:opacity-50',
                )}
              >
                {busy ? <><Loader2 className="h-3 w-3 animate-spin" />Planning…</> : <><Sparkles className="h-3 w-3" />Generate drafts</>}
              </button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
