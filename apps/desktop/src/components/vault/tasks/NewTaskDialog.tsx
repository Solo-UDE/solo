import { useState, type FC, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/taskStore';
import type { Executor, TaskPriority } from '@/lib/tauri/tasks';

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
}

export const NewTaskDialog: FC<Props> = ({ open, onClose }) => {
  const create = useTaskStore((s) => s.create);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [executor, setExecutor] = useState<Executor>('manual');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setTitle(''); setDescription(''); setExecutor('manual'); setPriority('medium');
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await create({ title: title.trim(), description, executor, priority });
      reset();
      onClose();
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
              'w-full max-w-md rounded-[14px] border border-border/60 bg-card p-5 shadow-lg',
              'flex flex-col gap-4',
            )}
          >
            <h2 className="text-[14px] font-semibold">New task</h2>

            <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
              Title
              <input
                autoFocus
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="rounded-md border border-border/60 bg-background px-2 py-1.5 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-border"
                placeholder="e.g. Review the billing proposal"
              />
            </label>

            <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
              Description (optional)
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="resize-none rounded-md border border-border/60 bg-background px-2 py-1.5 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-border"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
                Executor
                <select
                  value={executor}
                  onChange={(e) => setExecutor(e.target.value as Executor)}
                  className="rounded-md border border-border/60 bg-background px-2 py-1.5 text-[13px] text-foreground"
                >
                  <option value="manual">You</option>
                  <option value="agent">Agent</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
                Priority
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TaskPriority)}
                  className="rounded-md border border-border/60 bg-background px-2 py-1.5 text-[13px] text-foreground"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border/60 bg-background px-3 py-1.5 text-[12px] text-foreground hover:bg-muted/60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !title.trim()}
                className={cn(
                  'rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background',
                  'disabled:opacity-50',
                )}
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
