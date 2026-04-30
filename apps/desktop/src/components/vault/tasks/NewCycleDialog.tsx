import { useState, type FC, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { useCycleStore } from '@/stores/cycleStore';

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreated?: (id: string) => void;
}

const toEpochMs = (value: string): number => new Date(`${value}T00:00:00`).getTime();
const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const addDaysIso = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const NewCycleDialog: FC<Props> = ({ open, onClose, onCreated }) => {
  const create = useCycleStore((s) => s.create);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(addDaysIso(14));
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setName('');
    setStartDate(todayIso());
    setEndDate(addDaysIso(14));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const startAt = toEpochMs(startDate);
    const endAt = toEpochMs(endDate);
    if (endAt <= startAt) return;
    setSubmitting(true);
    try {
      // CycleDraft fields are i64 → bigint on the TS side.
      const cycle = await create({
        name: name.trim(),
        start_at: BigInt(startAt),
        end_at: BigInt(endAt),
      });
      reset();
      onClose();
      onCreated?.(cycle.id);
    } finally {
      setSubmitting(false);
    }
  };

  const rangeValid = toEpochMs(endDate) > toEpochMs(startDate);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="fixed inset-0 z-50 grid place-items-center bg-background/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.form
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={onSubmit}
            className={cn(
              'w-full max-w-md rounded-[14px] border border-border/40 bg-card/95 backdrop-blur-md p-5 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.2)]',
              'flex flex-col gap-4',
            )}
          >
            <h2 className="text-[14px] font-semibold">New cycle</h2>

            <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
              Name
              <input
                autoFocus
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-[10px] border border-border/40 bg-muted/40 px-2 py-1.5 text-[13px] text-foreground focus:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none transition-all duration-200"
                placeholder="e.g. Sprint 42"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
                Start
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="rounded-[10px] border border-border/40 bg-muted/40 px-2 py-1.5 text-[13px] text-foreground focus:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none transition-all duration-200"
                />
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
                End
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className={cn(
                    'rounded-[10px] border bg-muted/40 px-2 py-1.5 text-[13px] text-foreground focus:bg-muted/60 focus-visible:ring-2 focus-visible:outline-none transition-all duration-200',
                    rangeValid
                      ? 'border-border/40 focus-visible:ring-primary/20'
                      : 'border-red-500/60 focus-visible:ring-red-500/40',
                  )}
                />
              </label>
            </div>
            {!rangeValid && (
              <div className="text-[11px] text-red-500">
                End date must be after start date.
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-[10px] border border-border/40 bg-background px-3 text-[12px] text-foreground hover:bg-muted/60 active:scale-[0.97] transition-all duration-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !name.trim() || !rangeValid}
                className="h-9 rounded-[10px] bg-foreground px-3 text-[12px] font-medium text-background active:scale-[0.97] transition-all duration-200 disabled:opacity-50"
              >
                {submitting ? 'Creating…' : 'Create'}
              </button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
