/**
 * PrimarySidebar - Content sidebar with vertically stacked collapsible sections.
 * Shows Explorer, Sessions, and Source Control as expandable sections.
 * The active repo context is determined by the RepoRail selection.
 */

import { useCallback, useMemo, useState, forwardRef } from 'react';
import {
  Files,
  ChatTeardrop,
  GitBranch,
  TreeStructure,
  Broom,
  FilePlus,
  FolderPlus,
  ArrowsClockwise,
  ArrowsInSimple,
  X,
  Plus,
  CloudArrowDown,
  CloudArrowUp,
  FolderPlus as FolderPlusIcon,
} from '@phosphor-icons/react';
import { FileExplorer } from '@/components/file-explorer';
import { SessionList } from '@/components/agent';
import { SourceControlPanel } from '@/components/source-control';
import { WorktreePanel } from './WorktreePanel';
import { SidebarHeader } from './SidebarHeader';
import { CollapsibleSection } from './CollapsibleSection';
import { TRANSITIONS } from '@/lib/constants';
import { useIsLeftSidebarCollapsed } from '@/stores/uiStore';
import { useRepoStore, useRepoList } from '@/stores/repoStore';
import { useAgentStore } from '@/stores/agentStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import { useFileExplorerStore, getParentPath } from '@/stores/fileExplorerStore';
import { useGitStore } from '@/stores/gitStore';
import { useWorktreeStore } from '@/stores/worktreeStore';
import { BUILTIN_PANEL_TYPES } from '@/lib/panels';
import { openFolderDialog } from '@/lib/tauri/fs';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface PrimarySidebarProps {
  readonly width: number;
  readonly onFileOpen: (path: string) => void;
}

export const PrimarySidebar = forwardRef<HTMLElement, PrimarySidebarProps>(({ width, onFileOpen }, ref) => {
  const isCollapsed = useIsLeftSidebarCollapsed();
  const createSession = useAgentStore((state) => state.createSession);
  const addRepo = useRepoStore((state) => state.addRepo);
  const activeRepoPath = useRepoStore((state) => state.activeRepoPath);
  const isSwitching = useRepoStore((state) => state.isSwitching);
  const repos = useRepoList();

  const openPanel = useMemo(() => usePanelTabsStore.getState().openPanel, []);

  // File explorer state
  const rootPath = useFileExplorerStore((s) => s.rootPath);
  const selected = useFileExplorerStore((s) => s.selected);
  const startCreating = useFileExplorerStore((s) => s.startCreating);
  const setRootPath = useFileExplorerStore((s) => s.setRootPath);
  const closeFolder = useFileExplorerStore((s) => s.closeFolder);
  const collapseAll = useFileExplorerStore((s) => s.collapseAll);

  // Worktree state
  const pruneWorktrees = useWorktreeStore((s) => s.pruneWorktrees);
  const [showWorktreeCreate, setShowWorktreeCreate] = useState(false);

  const handlePrune = useCallback(async () => {
    try {
      const pruned = await pruneWorktrees();
      if (pruned.length > 0) {
        toast.success(`Pruned ${pruned.length} worktree${pruned.length > 1 ? 's' : ''}`);
      }
    } catch (err) {
      toast.error('Prune failed', { description: String(err) });
    }
  }, [pruneWorktrees]);

  // Git state
  const repoStatus = useGitStore((s) => s.repoStatus);
  const isPushing = useGitStore((s) => s.isPushing);
  const isPulling = useGitStore((s) => s.isPulling);
  const commitsAhead = useGitStore((s) => s.commitsAhead);
  const fetchChanges = useGitStore((s) => s.fetchChanges);
  const push = useGitStore((s) => s.push);
  const pull = useGitStore((s) => s.pull);

  // Open a session as a tab - find existing tab first, otherwise open new
  const handleSessionSelect = useCallback((sessionId: string): void => {
    const store = usePanelTabsStore.getState();
    for (const [instanceId, instance] of store.instances.entries()) {
      if (
        instance.panelType === BUILTIN_PANEL_TYPES.AGENT &&
        (instance.data as Record<string, unknown>)?.sessionId === sessionId
      ) {
        const tileId = store.findTileForPanel(instanceId);
        if (tileId) {
          store.setActiveTab(tileId, instanceId);
          return;
        }
      }
    }
    openPanel(BUILTIN_PANEL_TYPES.AGENT, { sessionId });
  }, [openPanel]);

  // Create session and open as tab
  const createSessionAndShow = useCallback((): void => {
    createSession().then((sessionId) => {
      if (sessionId) {
        openPanel(BUILTIN_PANEL_TYPES.AGENT, { sessionId });
      }
    }).catch((err: unknown) => {
      console.error('Failed to create session:', err);
    });
  }, [createSession, openPanel]);

  const handleNewSession = useCallback((): void => {
    createSessionAndShow();
  }, [createSessionAndShow]);

  // Add repository via folder picker
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

  // Explorer action helpers
  const getTargetDirectory = useCallback((): string | null => {
    const selectedPaths = Array.from(selected);
    if (selectedPaths.length > 0) {
      const entries = useFileExplorerStore.getState().entries;
      const entry = entries.get(selectedPaths[0]);
      return entry?.is_dir ? selectedPaths[0] : getParentPath(selectedPaths[0]);
    }
    return rootPath;
  }, [selected, rootPath]);

  const handleNewFile = useCallback(() => {
    const targetDir = getTargetDirectory();
    if (!targetDir) return;
    startCreating(targetDir, 'file');
  }, [getTargetDirectory, startCreating]);

  const handleNewFolder = useCallback(() => {
    const targetDir = getTargetDirectory();
    if (!targetDir) return;
    startCreating(targetDir, 'folder');
  }, [getTargetDirectory, startCreating]);

  const handleRefreshExplorer = useCallback(() => {
    if (rootPath) setRootPath(rootPath);
  }, [rootPath, setRootPath]);

  // Git action helpers
  const handlePull = useCallback(async () => {
    try {
      await pull();
      toast.success('Pulled from remote');
    } catch (err) {
      toast.error('Pull failed', { description: String(err) });
    }
  }, [pull]);

  const handlePush = useCallback(async () => {
    try {
      await push();
      toast.success('Pushed to remote');
    } catch (err) {
      toast.error('Push failed', { description: String(err) });
    }
  }, [push]);

  const handleRefreshGit = useCallback(() => {
    fetchChanges();
  }, [fetchChanges]);

  return (
    <aside
      ref={ref}
      className="h-full flex flex-col relative bg-sidebar overflow-hidden pt-[38px]"
      style={{
        width,
        transition: `width ${TRANSITIONS.sidebar}`,
      }}
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

          {/* Content area with collapsible sections */}
          {repos.length === 0 ? (
            /* Empty state - no repos */
            <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 text-center">
              <div className="w-10 h-10 rounded-xl bg-muted/40 flex items-center justify-center">
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
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
              {/* Worktrees section */}
              <CollapsibleSection
                title="Worktrees"
                icon={TreeStructure}
                defaultOpen={false}
                actions={
                  <>
                    <SectionIconButton onClick={() => setShowWorktreeCreate((prev) => !prev)} title="New Worktree" icon={Plus} />
                    <SectionIconButton onClick={handlePrune} title="Prune stale worktrees" icon={Broom} />
                  </>
                }
              >
                <WorktreePanel
                  embedded
                  className="h-full"
                  showCreate={showWorktreeCreate}
                  onShowCreateChange={setShowWorktreeCreate}
                />
              </CollapsibleSection>

              {/* Explorer section */}
              <CollapsibleSection
                title="Explorer"
                icon={Files}
                defaultOpen={true}
                actions={
                  rootPath ? (
                    <>
                      <SectionIconButton onClick={handleNewFile} title="New File" icon={FilePlus} />
                      <SectionIconButton onClick={handleNewFolder} title="New Folder" icon={FolderPlus} />
                      <SectionIconButton onClick={collapseAll} title="Collapse All" icon={ArrowsInSimple} />
                      <SectionIconButton onClick={handleRefreshExplorer} title="Refresh" icon={ArrowsClockwise} />
                      <SectionIconButton onClick={closeFolder} title="Close Folder" icon={X} />
                    </>
                  ) : undefined
                }
              >
                <FileExplorer
                  onFileOpen={onFileOpen}
                  className={cn(
                    'h-full transition-opacity duration-150',
                    isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100',
                  )}
                />
              </CollapsibleSection>

              {/* Sessions section */}
              <CollapsibleSection
                title="Sessions"
                icon={ChatTeardrop}
                defaultOpen={true}
                actions={
                  <SectionIconButton onClick={handleNewSession} title="New Session" icon={Plus} />
                }
              >
                <SessionList
                  onSessionSelect={handleSessionSelect}
                  onNewSession={handleNewSession}
                  className="h-full"
                />
              </CollapsibleSection>

              {/* Source Control section */}
              <CollapsibleSection
                title="Source Control"
                icon={GitBranch}
                defaultOpen={false}
                actions={
                  <>
                    <SectionIconButton
                      onClick={handlePull}
                      title="Pull"
                      icon={CloudArrowDown}
                      disabled={isPulling || !repoStatus?.has_remote}
                    />
                    <SectionIconButton
                      onClick={handlePush}
                      title={commitsAhead && commitsAhead > 0 ? `Push (${commitsAhead} ahead)` : 'Push'}
                      icon={CloudArrowUp}
                      disabled={isPushing || !repoStatus?.has_remote || commitsAhead === 0 || commitsAhead === null}
                    />
                    <SectionIconButton onClick={handleRefreshGit} title="Refresh" icon={ArrowsClockwise} />
                  </>
                }
              >
                <SourceControlPanel className="h-full" />
              </CollapsibleSection>
            </div>
          )}
        </>
      )}
    </aside>
  );
});

// ---------------------------------------------------------------------------
// SectionIconButton - Small icon button for section header actions
// ---------------------------------------------------------------------------

interface SectionIconButtonProps {
  onClick: () => void;
  title: string;
  icon: React.ComponentType<{ className?: string; weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone' }>;
  disabled?: boolean;
}

const SectionIconButton: React.FC<SectionIconButtonProps> = ({ onClick, title, icon: Icon, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={cn(
      'w-5 h-5 flex items-center justify-center rounded',
      'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      'disabled:opacity-30 disabled:pointer-events-none',
      'active:scale-95 transition-all duration-200',
    )}
    title={title}
  >
    <Icon className="w-3 h-3" weight="bold" />
  </button>
);
