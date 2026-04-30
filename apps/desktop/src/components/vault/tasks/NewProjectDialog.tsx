import { useState, type FC, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { useProjectStore } from '@/stores/projectStore';

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreated?: (id: string) => void;
}

const COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#0ea5e9', '#6366f1', '#a855f7', '#ec4899',
];

export const NewProjectDialog: FC<Props> = ({ open, onClose, onCreated }) => {
  const create = useProjectStore((s) => s.create);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setName('');
    setDescription('');
    setColor(COLORS[0]);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const project = await create({ name: name.trim(), description, color });
      reset();
      onClose();
      onCreated?.(project.id);
    } finally {
      setSubmitting(false);
    }
  };

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
            <h2 className="text-[14px] font-semibold">New project</h2>

            <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
              Name
              <input
                autoFocus
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-[10px] border border-border/40 bg-muted/40 px-2 py-1.5 text-[13px] text-foreground focus:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none transition-all duration-200"
                placeholder="e.g. Billing revamp"
              />
            </label>

            <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
              Description (optional)
              <textarea
                wrap="soft"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="resize-none overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words rounded-[10px] border border-border/40 bg-muted/40 px-2 py-1.5 text-[13px] text-foreground focus:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none transition-all duration-200"
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] text-muted-foreground">Color</span>
              <div className="flex gap-1.5">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={`Color ${c}`}
                    className={cn(
                      'h-6 w-6 rounded-full border-2 transition-all',
                      color === c ? 'border-foreground scale-110' : 'border-transparent',
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>

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
                disabled={submitting || !name.trim()}
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
