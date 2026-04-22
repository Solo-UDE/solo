import { useState, type FC, type FormEvent, type KeyboardEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/taskStore';
import type { Executor, TaskPriority } from '@/lib/tauri/tasks';
import { SelectDropdown } from '@/components/settings/controls/SelectDropdown';
import { PrioritySelector } from './PrioritySelector';

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
}

/**
 * Create-task modal with Circle's compact layout: title on top, inline
 * Executor + Priority selectors, description, and a dynamic subtask list you
 * build before submitting. Subtasks are submitted together with the task so
 * the agent's first message already includes the checklist if you assign
 * executor=agent and hit Run.
 */
export const NewTaskDialog: FC<Props> = ({ open, onClose }) => {
  const create = useTaskStore((s) => s.create);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [executor, setExecutor] = useState<Executor>('manual');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [subtasks, setSubtasks] = useState<string[]>([]);
  const [draftSub, setDraftSub] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setTitle('');
    setDescription('');
    setExecutor('manual');
    setPriority('medium');
    setSubtasks([]);
    setDraftSub('');
  };

  const addSub = () => {
    const t = draftSub.trim();
    if (!t) return;
    setSubtasks((prev) => [...prev, t]);
    setDraftSub('');
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await create({
        title: title.trim(),
        description,
        executor,
        priority,
        subtasks: subtasks.map((s) => ({ title: s })),
        label_ids: [],
      });
      reset();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const onSubKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addSub();
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
              'flex flex-col gap-4 max-h-[85vh] overflow-y-auto',
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

            <div className="flex flex-wrap items-center gap-2">
              <label className="flex min-w-[140px] flex-1 flex-col gap-1 text-[12px] text-muted-foreground">
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
              <div className="flex flex-col gap-1 text-[12px] text-muted-foreground">
                <span>Priority</span>
                <PrioritySelector value={priority} onChange={setPriority} />
              </div>
            </div>

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

            <section className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between px-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span>Subtasks</span>
                {subtasks.length > 0 && (
                  <span className="tabular-nums">{subtasks.length}</span>
                )}
              </div>

              {subtasks.length > 0 && (
                <ul className="flex flex-col gap-0.5">
                  {subtasks.map((s, i) => (
                    <li
                      key={`${s}-${i}`}
                      className="flex items-center gap-2 rounded-[8px] bg-muted/30 px-2 py-1.5 text-[12.5px]"
                    >
                      <span className="flex-1 truncate">{s}</span>
                      <button
                        type="button"
                        aria-label="Remove subtask"
                        onClick={() => setSubtasks((prev) => prev.filter((_, j) => j !== i))}
                        className="grid h-5 w-5 place-items-center rounded-sm text-muted-foreground/50 hover:text-red-500"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex items-center gap-2 rounded-[8px] border border-dashed border-border/50 bg-muted/20 px-2 py-1.5">
                <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                <input
                  value={draftSub}
                  onChange={(e) => setDraftSub(e.target.value)}
                  onKeyDown={onSubKey}
                  placeholder="Add a subtask…"
                  className="flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground"
                />
                {draftSub.trim() && (
                  <button
                    type="button"
                    onClick={addSub}
                    className="rounded-md bg-muted/60 px-2 py-0.5 text-[11px] font-medium hover:bg-muted"
                  >
                    Add
                  </button>
                )}
              </div>
            </section>

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
