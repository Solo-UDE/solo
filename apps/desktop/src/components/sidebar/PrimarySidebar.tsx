/**
 * PrimarySidebar - Thin routing shell for the content sidebar.
 * Renders ModeToggle + DevSidebar or StudioSidebar based on sidebar mode.
 * The active repo context is determined by the RepoRail selection.
 */

import { useCallback, forwardRef } from 'react';
import { motion } from 'motion/react';
import { FolderPlus as FolderPlusIcon } from '@phosphor-icons/react';
import { ModeToggle } from './ModeToggle';
import { DevSidebar } from './DevSidebar';
import { StudioSidebar } from './StudioSidebar';
import { SidebarHeader } from './SidebarHeader';
import { useUIStore, useIsLeftSidebarCollapsed } from '@/stores/uiStore';
import { useRepoStore, useRepoList } from '@/stores/repoStore';
import { openFolderDialog } from '@/lib/tauri/fs';
import { toast } from 'sonner';

interface PrimarySidebarProps {
  readonly width: number;
  readonly onFileOpen: (path: string) => void;
}

export const PrimarySidebar = forwardRef<HTMLElement, PrimarySidebarProps>(({ width, onFileOpen }, ref) => {
  const isCollapsed = useIsLeftSidebarCollapsed();
  const addRepo = useRepoStore((state) => state.addRepo);
  const activeRepoPath = useRepoStore((state) => state.activeRepoPath);
  const isSwitching = useRepoStore((state) => state.isSwitching);
  const repos = useRepoList();
  const sidebarMode = useUIStore((s) => s.sidebarMode);

  const handleAddRepo = useCallback(async () => {
    try {
      const path = await openFolderDialog();
      if (path) {
        await addRepo(path);
      }
    } catch (err) {
      toast.error('Failed to add repository', { description: String(err) });
    }
  }, [addRepo]);

  const isResizing = typeof document !== 'undefined' && document.body.classList.contains('is-resizing');

  return (
    <motion.aside
      ref={ref}
      className="h-full flex flex-col relative bg-sidebar overflow-hidden pt-[38px]"
      animate={{ width }}
      transition={isResizing ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 30 }}
      style={{ width }}
    >
      {/* Loading overlay during repo switch */}
      {isSwitching && (
        <div className="absolute inset-0 z-10 bg-sidebar/50 animate-pulse pointer-events-none" />
      )}

      {!isCollapsed && (
        <>
          {/* Header showing active repo + branch */}
          {activeRepoPath ? (
            <SidebarHeader />
          ) : (
            <div className="h-9 flex items-center px-2.5 shrink-0 border-b border-border/10">
              <span className="text-xs font-semibold text-muted-foreground/70">Solo</span>
            </div>
          )}

          {/* Content area */}
          {repos.length === 0 ? (
            /* Empty state - no repos */
            <motion.div
              className="flex-1 flex flex-col items-center justify-center gap-3 px-4 text-center"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
            >
              <div className="w-12 h-12 rounded-2xl bg-muted/40 flex items-center justify-center">
                <FolderPlusIcon className="w-5 h-5 text-muted-foreground/50" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground/70 mb-1">No repositories</p>
                <p className="text-xs text-muted-foreground/40">Add a repository to get started</p>
              </div>
              <button
                onClick={handleAddRepo}
                className="h-8 px-3.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 active:scale-[0.97] transition-all duration-200"
              >
                Add Repository
              </button>
            </motion.div>
          ) : (
            <>
              <ModeToggle />
              {sidebarMode === 'dev' ? (
                <DevSidebar onFileOpen={onFileOpen} />
              ) : (
                <StudioSidebar />
              )}
            </>
          )}
        </>
      )}
    </motion.aside>
  );
});
