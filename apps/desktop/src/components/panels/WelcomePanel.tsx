/**
 * WelcomePanel - Welcome screen panel
 * Shows when no files are open
 */

import { motion } from 'framer-motion';
import { useFileExplorerStore } from '@/stores/fileExplorerStore';
import type { PanelProps } from '@/lib/panels/types';

const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] as const } },
};

export function WelcomePanel(_props: PanelProps) {
  const openFolder = useFileExplorerStore((s) => s.openFolder);
  const rootPath = useFileExplorerStore((s) => s.rootPath);

  return (
    <div className="h-full flex items-center justify-center bg-background">
      <motion.div
        className="text-center space-y-6"
        initial="hidden"
        animate="visible"
        variants={staggerContainer}
      >
        <motion.div className="space-y-2" variants={fadeUp}>
          <h1 className="text-4xl font-bold tracking-tight">Solo IDE</h1>
          <p className="text-muted-foreground">AI-native development environment</p>
        </motion.div>

        {rootPath ? (
          <motion.div className="pt-4" variants={fadeUp}>
            <p className="text-sm text-muted-foreground">
              Open a file from the explorer to start editing
            </p>
          </motion.div>
        ) : (
          <motion.div className="pt-8 flex gap-3 justify-center" variants={fadeUp}>
            <button className="h-10 px-5 bg-primary text-primary-foreground rounded-xl font-medium hover:brightness-110 active:scale-[0.97] transition-all duration-200">
              New Project
            </button>
            <button
              onClick={openFolder}
              className="h-10 px-5 bg-muted/60 text-foreground rounded-xl font-medium hover:bg-muted active:scale-[0.97] transition-all duration-200"
            >
              Open Folder
            </button>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
