/**
 * PrimarySidebar - Thin routing shell for the content sidebar.
 * Renders ModeToggle + DevSidebar or VaultSidebar based on sidebar mode.
 * The active repo context is determined by the RepoRail selection.
 */

import { useCallback, forwardRef } from 'react';
import { motion } from 'motion/react';
import { FolderPlus as FolderPlusIcon } from 'lucide-react';
import { ModeToggle } from './ModeToggle';
import { DevSidebar } from './DevSidebar';
import { VaultSidebar } from './VaultSidebar';
import { SidebarHeader } from './SidebarHeader';
import { useUIStore, useIsLeftSidebarCollapsed } from '@/stores/uiStore';
import { useRepoStore, useRepoList } from '@/stores/repoStore';
import { openFolderDialog } from '@/lib/tauri/fs';
import { HEIGHTS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface PrimarySidebarProps {
  readonly width: number;
  readonly isResizing?: boolean;
  readonly onFileOpen: (path: string) => void;
}

export const PrimarySidebar = forwardRef<HTMLElement, PrimarySidebarProps>(({ width, isResizing = false, onFileOpen }, ref) => {
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

  return (
    <motion.aside
      ref={ref}
      className={`liquid-sidebar relative flex h-full flex-col overflow-hidden bg-sidebar ${
        isResizing ? '' : 'transition-[width] duration-200 ease-[var(--ease-smooth)]'
      }`}
      style={{ width, paddingTop: HEIGHTS.titlebar }}
    >
      {/* Loading overlay during repo switch */}
      {isSwitching && (
        <div className="absolute inset-0 z-10 bg-sidebar/50 animate-pulse pointer-events-none" />
      )}

      {!isCollapsed && (
        <>
          <div className="shrink-0 px-3 pb-2 pt-2.5">
            {activeRepoPath ? (
              <SidebarHeader />
            ) : (
              <div className="rounded-[10px] border border-border/70 bg-background/55 px-3.5 py-3.5">
                <p className="text-sm font-medium text-foreground">No repository selected</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Add a repository to open files, create worktrees, and start agent sessions.
                </p>
              </div>
            )}
          </div>

          {repos.length === 0 ? (
            <motion.div
              className="flex flex-1 flex-col items-center justify-center gap-4 px-6 pb-8 text-center"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-[10px] border border-border/70 bg-background/75">
                <FolderPlusIcon className="w-5 h-5 text-muted-foreground/50" />
              </div>
              <div>
                <p className="mb-1 text-sm font-medium text-foreground">No repositories yet</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Bring a project into Solo to unlock the Codex-style workspace.
                </p>
              </div>
              <button
                onClick={handleAddRepo}
                className="inline-flex h-8 items-center rounded-[8px] border border-primary/20 bg-primary/10 px-3.5 text-xs font-medium text-primary hover:bg-primary/15 active:scale-[0.97] transition-[background-color,transform] duration-150"
              >
                Add Repository
              </button>
            </motion.div>
          ) : (
            <>
              <ModeToggle />
              <div className="relative min-h-0 flex-1 overflow-hidden">
                <div className={cn('absolute inset-0 flex min-h-0 flex-col', sidebarMode !== 'dev' && 'hidden')}>
                  <DevSidebar onFileOpen={onFileOpen} isActive={sidebarMode === 'dev'} />
                </div>
                <div className={cn('absolute inset-0 flex min-h-0 flex-col', sidebarMode !== 'vault' && 'hidden')}>
                  <VaultSidebar isActive={sidebarMode === 'vault'} />
                </div>
              </div>
            </>
          )}
        </>
      )}
    </motion.aside>
  );
});
