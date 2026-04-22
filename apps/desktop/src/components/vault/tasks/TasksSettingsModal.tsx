import type { FC } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { PlannerNotesSetting } from './PlannerNotesSetting';

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
}

export const TasksSettingsModal: FC<Props> = ({ open, onClose }) => (
  <AnimatePresence>
    {open && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 grid place-items-center bg-background/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          onClick={(e) => e.stopPropagation()}
          className="flex w-full max-w-md flex-col rounded-[14px] border border-border/60 bg-card shadow-lg"
        >
          <header className="flex items-center justify-between border-b border-border/50 px-4 py-3">
            <h2 className="text-[14px] font-semibold">Tasks settings</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted/50"
            >
              <X className="h-4 w-4" />
            </button>
          </header>
          <PlannerNotesSetting />
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);
