import { useState, useCallback, useEffect } from 'react';
import { FolderOpen, GitBranch, Clock, FolderSimple, X } from '@phosphor-icons/react';
import { Button, IconButton } from '@solo/ui';
import SoloDecryptAnimation from '../agent/SoloDecryptAnimation';
import { StarsBackground } from '@/components/ui/stars-background';
import { CloneDialog } from './CloneDialog';
import { openFolderDialog } from '@/lib/tauri/fs';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useRepoStore } from '@/stores/repoStore';
import { useStartupSound } from '@/hooks/useStartupSound';

/** Extract the last segment of a path */
const dirName = (p: string) => {
  const sep = p.includes('\\') ? '\\' : '/';
  return p.split(sep).pop() ?? p;
};

/** Truncate a path for display */
const truncatePath = (p: string, maxLen = 50) => {
  if (p.length <= maxLen) return p;
  const sep = p.includes('\\') ? '\\' : '/';
  const parts = p.split(sep);
  if (parts.length <= 3) return p;
  return `...${sep}${parts.slice(-3).join(sep)}`;
};

export function WelcomeScreen() {
  const recentDirectories = useWorkspaceStore((s) => s.recentDirectories);
  const removeRecent = useWorkspaceStore((s) => s.removeRecent);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [showContent, setShowContent] = useState(false);

  // Play startup sound on first mount (synced with decrypt animation)
  useStartupSound();

  // Reveal content after the decrypt animation assembles (~2.4s)
  useEffect(() => {
    const t = setTimeout(() => setShowContent(true), 2400);
    return () => clearTimeout(t);
  }, []);

  // Open or select a repo via the repoStore (which internally calls switchWorkspace)
  const openOrSelectRepo = useCallback(async (path: string) => {
    const store = useRepoStore.getState();
    if (store.repos.has(path)) {
      await store.selectWorktree(path, null);
    } else {
      await store.addRepo(path);
    }
  }, []);

  const handleOpenProject = useCallback(async () => {
    const path = await openFolderDialog();
    if (path) {
      await openOrSelectRepo(path);
    }
  }, [openOrSelectRepo]);

  const handleSwitchTo = useCallback(
    async (path: string) => {
      await openOrSelectRepo(path);
    },
    [openOrSelectRepo],
  );

  const handleRemoveRecent = useCallback(
    (e: React.MouseEvent, path: string) => {
      e.stopPropagation();
      removeRecent(path);
    },
    [removeRecent],
  );

  // ⌘O keyboard shortcut to open project
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'o') {
        e.preventDefault();
        handleOpenProject();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleOpenProject]);

  return (
    <>
      <div className="relative bg-background flex-1 flex flex-col items-center justify-center h-full overflow-hidden select-none">
        {/* Animated stars background (dark mode only) */}
        <StarsBackground
          className="absolute inset-0 z-0"
          count={150}
          speed={30}
          starColor="rgba(255,255,255,0.6)"
          pointerEvents={false}
        />

        {/* Animated glow — breathes continuously while welcome screen is visible */}
        <div
          className="absolute top-[30%] left-1/2 rounded-full pointer-events-none startup-glow z-[1]"
          style={{
            width: 300,
            height: 300,
            background: 'radial-gradient(circle, var(--primary) 0%, transparent 70%)',
            filter: 'blur(90px)',
          }}
        />

        {/* Solo decrypt animation */}
        <SoloDecryptAnimation />

        {/* Tagline */}
        <p className="relative z-10 text-xs text-muted-foreground/50 tracking-wide mt-4">
          Your AI coding agent
        </p>

        {/* Action buttons — fade in after decrypt assembles */}
        <div
          className="relative z-10 flex items-center gap-3 mt-8"
          style={{
            opacity: showContent ? 1 : 0,
            transform: showContent ? 'translateY(0)' : 'translateY(8px)',
            transition: 'opacity 280ms var(--ease-smooth), transform 280ms var(--ease-smooth)',
          }}
        >
          <Button
            variant="primary"
            size="sm"
            onClick={handleOpenProject}
            className="text-xs shadow-sm"
          >
            <FolderOpen className="w-3.5 h-3.5" weight="duotone" />
            Open Project
            <kbd className="ml-1 text-[10px] opacity-60 font-normal">⌘O</kbd>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setCloneOpen(true)}
            className="text-xs"
          >
            <GitBranch className="w-3.5 h-3.5 text-muted-foreground" />
            Clone from GitHub
          </Button>
        </div>

        {/* Recent Projects — staggered fade-in */}
        {recentDirectories.length > 0 && (
          <div
            className="relative z-10 mt-8 w-full max-w-sm"
            style={{
              opacity: showContent ? 1 : 0,
              transform: showContent ? 'translateY(0)' : 'translateY(8px)',
              transition: 'opacity 280ms var(--ease-smooth) 60ms, transform 280ms var(--ease-smooth) 60ms',
            }}
          >
            <div className="rounded-xl bg-card/50 border border-border/30 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Clock className="w-3 h-3 text-muted-foreground/50" />
                <span className="text-[10px] font-medium text-muted-foreground/50 tracking-wide">
                  Recent Projects
                </span>
              </div>
              <div className="space-y-0.5">
                {recentDirectories.slice(0, 5).map((path, i) => (
                  <div
                    key={path}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSwitchTo(path)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSwitchTo(path); } }}
                    className="group w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs hover:bg-muted/40 active:scale-[0.99] transition-all duration-150 cursor-pointer"
                    style={{
                      opacity: showContent ? 1 : 0,
                      transform: showContent ? 'translateY(0)' : 'translateY(8px)',
                      transition: `opacity 250ms var(--ease-smooth) ${100 + i * 40}ms, transform 250ms var(--ease-smooth) ${100 + i * 40}ms`,
                    }}
                  >
                    <FolderSimple className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0 text-left">
                      <div className="text-foreground/80 truncate">{dirName(path)}</div>
                      <div
                        className="text-[10px] text-muted-foreground/50 truncate"
                        title={path}
                      >
                        {truncatePath(path)}
                      </div>
                    </div>
                    <IconButton
                      variant="ghost"
                      size="sm"
                      onClick={(e) => handleRemoveRecent(e, path)}
                      className="w-5 h-5 opacity-0 group-hover:opacity-100 hover:bg-destructive/10 transition-opacity duration-150"
                      title="Remove from recents"
                    >
                      <X className="w-3 h-3 text-muted-foreground" />
                    </IconButton>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Version footer */}
        <div
          className="absolute bottom-4 text-[10px] text-muted-foreground/30"
          style={{
            opacity: showContent ? 1 : 0,
            transition: 'opacity 400ms var(--ease-smooth) 200ms',
          }}
        >
          v0.1.0
        </div>
      </div>

      {/* Clone dialog */}
      {cloneOpen && (
        <CloneDialog onClose={() => setCloneOpen(false)} />
      )}
    </>
  );
}
