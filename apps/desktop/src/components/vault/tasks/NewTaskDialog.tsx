import { useState, type FC, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/taskStore';
import type { Executor, TaskPriority } from '@/lib/tauri/tasks';
import { SelectDropdown } from '@/components/settings/controls/SelectDropdown';

const pretty = (v: string) => v.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

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
              'w-full max-w-md rounded-[14px] border border-border/40 bg-card/95 backdrop-blur-md p-5 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.2)]',
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
                className="rounded-[10px] border border-border/40 bg-muted/40 px-2 py-1.5 text-[13px] text-foreground focus:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none transition-all duration-200"
                placeholder="e.g. Review the billing proposal"
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

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
                Executor
                <SelectDropdown
                  value={executor}
                  options={[
                    { label: 'You', value: 'manual' as Executor },
                    { label: 'Agent', value: 'agent' as Executor },
                  ]}
                  onChange={(v) => setExecutor(v)}
                />
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
                Priority
                <SelectDropdown
                  value={priority}
                  options={(['low', 'medium', 'high', 'urgent'] as TaskPriority[]).map((p) => ({ label: pretty(p), value: p }))}
                  onChange={(v) => setPriority(v)}
                />
              </label>
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
                disabled={submitting || !title.trim()}
                className={cn(
                  'h-9 rounded-[10px] bg-foreground px-3 text-[12px] font-medium text-background',
                  'active:scale-[0.97] transition-all duration-200 disabled:opacity-50',
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
