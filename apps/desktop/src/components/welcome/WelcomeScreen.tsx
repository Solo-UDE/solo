import { useState, useCallback, useEffect, type MouseEvent } from 'react';
import { Cross2Icon } from '@radix-ui/react-icons';
import { FolderOpen, GitBranch, Clock, Folder } from 'lucide-react';

import { CloneDialog } from './CloneDialog';
import { StarsBackground } from '@/components/ui/stars-background';
import SoloDecryptAnimation from '../agent/SoloDecryptAnimation';
import { openFolderDialog } from '@/lib/tauri/fs';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useRepoStore } from '@/stores/repoStore';
import { useStartupSound } from '@/hooks/useStartupSound';

const dirName = (p: string) => {
  const sep = p.includes('\\') ? '\\' : '/';
  return p.split(sep).pop() ?? p;
};

const truncatePath = (p: string, maxLen = 50) => {
  if (p.length <= maxLen) return p;
  const sep = p.includes('\\') ? '\\' : '/';
  const parts = p.split(sep);
  if (parts.length <= 3) return p;
  return `...${sep}${parts.slice(-3).join(sep)}`;
};

interface WelcomeScreenProps {
  onProjectOpen?: () => void;
}

export function WelcomeScreen({ onProjectOpen }: WelcomeScreenProps = {}) {
  const recentDirectories = useWorkspaceStore((s) => s.recentDirectories);
  const removeRecent = useWorkspaceStore((s) => s.removeRecent);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [showContent, setShowContent] = useState(false);
  const [showRecentProjects, setShowRecentProjects] = useState(false);

  useStartupSound();

  useEffect(() => {
    const timer = setTimeout(() => setShowContent(true), 2400);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!showContent || recentDirectories.length === 0) {
      setShowRecentProjects(false);
      return;
    }

    const timer = setTimeout(() => setShowRecentProjects(true), 120);
    return () => clearTimeout(timer);
  }, [recentDirectories.length, showContent]);

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
    if (!path) return;
    onProjectOpen?.();
    await openOrSelectRepo(path);
  }, [onProjectOpen, openOrSelectRepo]);

  const handleSwitchTo = useCallback(
    async (path: string) => {
      onProjectOpen?.();
      await openOrSelectRepo(path);
    },
    [onProjectOpen, openOrSelectRepo],
  );

  const handleRemoveRecent = useCallback(
    (e: MouseEvent, path: string) => {
      e.stopPropagation();
      removeRecent(path);
    },
    [removeRecent],
  );

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
      <div className="relative flex h-full flex-1 select-none flex-col items-center justify-center overflow-hidden bg-background">
        <div
          className="absolute inset-0 opacity-100"
          style={{
            background:
              'radial-gradient(circle at 50% 34%, color-mix(in oklch, var(--primary) 9%, transparent) 0%, transparent 38%), linear-gradient(180deg, transparent, color-mix(in oklch, var(--background) 92%, transparent))',
          }}
        />

        <StarsBackground
          className="absolute inset-0 z-0"
          count={150}
          speed={30}
          starColor="rgba(255,255,255,0.6)"
          pointerEvents={false}
        />

        <div
          className="startup-glow pointer-events-none absolute left-1/2 top-[30%] z-[1] rounded-full"
          style={{
            width: 300,
            height: 300,
            background: 'radial-gradient(circle, color-mix(in oklch, var(--primary) 70%, transparent) 0%, transparent 70%)',
            filter: 'blur(90px)',
            transform: 'translateX(-50%)',
          }}
        />

        <div className="relative z-10 flex w-full max-w-4xl flex-col items-center px-6">
          <SoloDecryptAnimation />

          <p className="mt-4 text-[12px] tracking-[0.08em] text-muted-foreground/65">
            Your AI coding agent
          </p>

          <div
            className="mt-8 flex flex-wrap items-center justify-center gap-3"
            style={{
              opacity: showContent ? 1 : 0,
              transform: showContent ? 'translateY(0)' : 'translateY(8px)',
              transition: 'opacity 280ms var(--ease-smooth), transform 280ms var(--ease-smooth)',
            }}
          >
            <button
              onClick={handleOpenProject}
              className="inline-flex h-10 items-center gap-2 rounded-[12px] bg-primary px-4 text-[13px] font-medium text-primary-foreground shadow-[0_14px_32px_-24px_rgba(0,0,0,0.4)] transition-[transform,filter] duration-150 hover:brightness-105 active:scale-[0.96]"
            >
              <FolderOpen className="h-4 w-4" />
              Open project
              <span className="rounded-[6px] bg-black/10 px-1.5 py-0.5 text-[10px] text-primary-foreground/80">
                ⌘O
              </span>
            </button>

            <button
              onClick={() => setCloneOpen(true)}
              className="inline-flex h-10 items-center gap-2 rounded-[12px] border border-border/65 bg-card/78 px-4 text-[13px] font-medium text-foreground shadow-[0_14px_32px_-28px_rgba(0,0,0,0.32)] backdrop-blur-sm transition-[transform,background-color,border-color] duration-150 hover:border-border hover:bg-card/92 active:scale-[0.96]"
            >
              <GitBranch className="h-4 w-4 text-primary" />
              Clone repository
            </button>
          </div>

          {recentDirectories.length > 0 ? (
            <div
              className="relative z-10 mt-8 w-full max-w-[30rem]"
              style={{
                opacity: showRecentProjects ? 1 : 0,
                transform: showRecentProjects ? 'translateY(0) scale(1)' : 'translateY(18px) scale(0.985)',
                filter: showRecentProjects ? 'blur(0px)' : 'blur(8px)',
                transition:
                  'opacity 420ms var(--ease-smooth), transform 520ms var(--ease-smooth), filter 420ms var(--ease-smooth)',
                willChange: 'opacity, transform, filter',
              }}
            >
              <div className="rounded-[16px] border border-border/60 bg-card/74 p-3 shadow-[0_18px_40px_-30px_rgba(0,0,0,0.35)] backdrop-blur-xl">
                <div className="mb-2 flex items-center gap-1.5 px-1">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground/55" />
                  <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/55">
                    Recent Projects
                  </span>
                </div>

                <div className="space-y-1">
                  {recentDirectories.slice(0, 5).map((path, index) => (
                    <div
                      key={path}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSwitchTo(path)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleSwitchTo(path);
                        }
                      }}
                      className="group flex w-full cursor-pointer items-center gap-3 rounded-[11px] px-3 py-2.5 text-left transition-[transform,background-color,border-color] duration-150 hover:bg-background/68 active:scale-[0.99]"
                      style={{
                        opacity: showRecentProjects ? 1 : 0,
                        transform: showRecentProjects ? 'translateY(0)' : 'translateY(12px)',
                        filter: showRecentProjects ? 'blur(0px)' : 'blur(6px)',
                        transition: `opacity 320ms var(--ease-smooth) ${140 + index * 75}ms, transform 420ms var(--ease-smooth) ${140 + index * 75}ms, filter 360ms var(--ease-smooth) ${140 + index * 75}ms`,
                        willChange: 'opacity, transform, filter',
                      }}
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-border/50 bg-background/58">
                        <Folder className="h-4 w-4 text-muted-foreground" />
                      </div>

                      <div className="min-w-0 flex-1 text-left">
                        <div className="truncate text-[13px] font-medium text-foreground">
                          {dirName(path)}
                        </div>
                        <div
                          className="mt-0.5 truncate text-[11px] text-muted-foreground/75"
                          title={path}
                        >
                          {truncatePath(path)}
                        </div>
                      </div>

                      <button
                        onClick={(e) => handleRemoveRecent(e, path)}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-muted-foreground opacity-0 transition-[opacity,background-color,color] duration-150 hover:bg-background group-hover:opacity-100"
                        title="Remove from recents"
                      >
                        <Cross2Icon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div
          className="absolute bottom-4 z-10 text-[10px] text-muted-foreground/35"
          style={{
            opacity: showContent ? 1 : 0,
            transition: 'opacity 400ms var(--ease-smooth) 200ms',
          }}
        >
          v0.1.0
        </div>
      </div>

      {cloneOpen ? <CloneDialog onClose={() => setCloneOpen(false)} /> : null}
    </>
  );
}
