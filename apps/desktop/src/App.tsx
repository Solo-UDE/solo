import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "motion/react";
import { GearIcon, ExitIcon } from "@radix-ui/react-icons";
import { Bug, Terminal, PanelLeft } from "lucide-react";
import { PrimarySidebar } from "./components/sidebar";
import { RepoRail } from "./components/sidebar/RepoRail";
import { SidebarTerminal } from "./components/sidebar";
import { MosaicLayout } from "./components/panels";
import { AuthGuard } from "./components/auth";
import { useUIStore, useIsLeftSidebarCollapsed } from "./stores/uiStore";
import { usePanelTabsStore } from "./stores/panelTabsStore";
import { useProviderStore } from "./stores/provider-store";
import { useAgentStore } from "./stores/agentStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useAuthStore, useUser } from "./stores/authStore";
import { registerBuiltinPanels, BUILTIN_PANEL_TYPES, DEFAULT_TILES } from "./lib/panels";
import { SettingsView } from "./components/settings";
import { useAutosave } from "./hooks/useAutosave";
import { useAppZoom } from "./hooks/useAppZoom";
import { useColorScheme } from "./hooks/useColorScheme";
import { useTitlebarStyle } from "./hooks/usePlatform";
import { useAgentStream } from "./hooks/useAgentStream";
import { useTerminalStream } from "./hooks/useTerminalStream";
import { useGitStream } from "./hooks/useGitStream";
import { useWorktreeStream } from "./hooks/useWorktreeStream";
import { useElevenLabsStream } from "./hooks/useElevenLabsStream";
import { useUpdateStream } from "./hooks/useUpdateStream";
import { useVaultStream } from "./hooks/useVaultStream";
import { useTerminalStore, clearActiveTerminal, findInActiveTerminal } from "./stores/terminalStore";
import { useFileExplorerStore } from "./stores/fileExplorerStore";
import { useGitHubAccountsStore } from "./stores/githubAccountsStore";
import { useRepoStore } from "./stores/repoStore";
import { createTerminal, killTerminal } from "./lib/tauri/terminal";
import { HEIGHTS, SIDEBAR } from "./lib/constants";
import { cn } from "./lib/utils";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { Toaster } from "@solo/ui";
import { TitlebarButton } from "./components/titlebar/TitlebarButton";
import { WelcomeScreen } from "./components/welcome";
import { KeyboardShortcutsOverlay } from "./components/KeyboardShortcutsOverlay";
import { BugReportDialog } from "./components/bug-report/BugReportDialog";
import { TabSwitcher } from "./components/panels/TabSwitcher";
import { SkillsOnboardingDialog } from "./components/agent/SkillsOnboardingDialog";

// Shared easing curve matching --ease-smooth
const EASE_SMOOTH: [number, number, number, number] = [0.16, 1, 0.3, 1];

// Register built-in panels on module load
registerBuiltinPanels();

function AppContent() {
  const [, setBackendStatus] = useState<string>("Connecting...");
  const sidebarRef = useRef<HTMLElement>(null);
  const dragStartX = useRef<number>(0);
  const dragStartWidth = useRef<number>(0);

  // Keyboard shortcuts overlay state
  const [shortcutsOverlayOpen, setShortcutsOverlayOpen] = useState(false);

  // Bug report dialog state
  const [bugReportOpen, setBugReportOpen] = useState(false);

  // Tab switcher (Cmd+Shift+T)
  const [tabSwitcherOpen, setTabSwitcherOpen] = useState(false);

  // Splash gate — WelcomeScreen stays until user picks a project
  const [splashComplete, setSplashComplete] = useState(false);

  // Terminal panel drag state
  const [isDraggingTerminal, setIsDraggingTerminal] = useState(false);
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);
  const dragStartY = useRef<number>(0);
  const dragStartHeight = useRef<number>(0);

  const leftSidebarWidth = useUIStore((state) => state.leftSidebarWidth);
  const setLeftSidebarWidth = useUIStore((state) => state.setLeftSidebarWidth);
  const toggleLeftSidebar = useUIStore((state) => state.toggleLeftSidebar);
  const isCollapsed = useIsLeftSidebarCollapsed();
  const terminalPanelOpen = useUIStore((s) => s.terminalPanelOpen);
  const settingsOpen = useUIStore((s) => s.settingsOpen);
  const openSettings = useUIStore((s) => s.openSettings);
  const closeSettings = useUIStore((s) => s.closeSettings);
  const terminalPanelHeight = useUIStore((s) => s.terminalPanelHeight);
  const setTerminalPanelHeight = useUIStore((s) => s.setTerminalPanelHeight);
  const initializeProviders = useProviderStore((state) => state.initialize);
  const loadPersistedSessions = useAgentStore((state) => state.loadPersistedSessions);
  const signOut = useAuthStore((state) => state.signOut);
  const user = useUser();
  const rootPath = useFileExplorerStore((s) => s.rootPath);
  const hasRepos = useRepoStore((s) => s.repos.size > 0);
  const sidebarMode = useUIStore((s) => s.sidebarMode);

  // Get openPanel action directly from store to avoid selector subscription issues
  const openPanel = useMemo(() => usePanelTabsStore.getState().openPanel, []);

  // Enable autosave on blur and tab switch
  useAutosave();

  // Apply persisted zoom level to the webview, react to Cmd+=/Cmd+-/Cmd+0 changes
  useAppZoom();

  // A2: beforeunload warning for unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const hasDirty = usePanelTabsStore.getState().hasDirtyPanels();
      if (hasDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Apply color scheme to document
  const resolvedTheme = useColorScheme();

  // Set vibrancy attribute from React (Rust's window.eval fires before DOM is ready)
  useEffect(() => {
    const isMac = navigator.platform.startsWith('Mac') || navigator.userAgent.includes('Macintosh');
    if (isMac) {
      document.documentElement.setAttribute('data-vibrancy', 'true');
    }
  }, []);

  // Platform-aware titlebar padding
  const titlebarStyle = useTitlebarStyle();

  useEffect(() => {
    // Test IPC connection with ping
    invoke<string>("ping")
      .then((response) => {
        console.log("Backend connected:", response);
        setBackendStatus("connected");
      })
      .catch((err) => {
        console.error("Backend error:", err);
        setBackendStatus("error");
      });
  }, []);

  // Initialize provider store on startup
  useEffect(() => {
    initializeProviders().catch((err) => {
      console.error("Failed to initialize providers:", err);
    });
  }, [initializeProviders]);

  // Set up event stream listeners (hooks manage their own lifecycle)
  useAgentStream();
  useTerminalStream();
  useGitStream();
  useWorktreeStream();
  useElevenLabsStream();
  useUpdateStream();
  useVaultStream();

  // Load GitHub token from keychain so the header shows auth status
  useEffect(() => {
    useGitHubAccountsStore.getState().loadToken();
  }, []);

  // Startup restore: repo + worktree, sessions, then re-open the last-active
  // chat as a panel tab so users land back in the same place they left.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.all([
        useRepoStore.getState().restoreActiveRepo(),
        loadPersistedSessions().then(() => {
          const days = useSettingsStore.getState().ai.sessionRetentionDays;
          return useAgentStore.getState().pruneExpiredSessions(days);
        }),
      ]);
      if (cancelled) return;

      const activeRepoPath = useRepoStore.getState().activeRepoPath;
      if (!activeRepoPath) return;

      const { sessions, activeSessionId } = useAgentStore.getState();
      const activeWorktreeId = useRepoStore.getState().activeWorktreeId;

      // Prefer the per-workspace remembered session, then the store's active,
      // then the most-recent session on the active worktree.
      const remembered = localStorage.getItem(`solo-active-session:${activeRepoPath}`);
      let sessionIdToOpen: string | null = null;
      if (remembered && sessions.has(remembered)) {
        sessionIdToOpen = remembered;
      } else if (activeSessionId && sessions.has(activeSessionId)) {
        sessionIdToOpen = activeSessionId;
      } else {
        let mostRecentTime = 0;
        for (const session of sessions.values()) {
          if (session.worktreeId !== (activeWorktreeId ?? undefined)) continue;
          const t = session.lastActiveAt ? new Date(session.lastActiveAt).getTime() : 0;
          if (t > mostRecentTime) {
            mostRecentTime = t;
            sessionIdToOpen = session.id;
          }
        }
      }

      if (cancelled || !sessionIdToOpen) return;
      usePanelTabsStore.getState().openPanel(BUILTIN_PANEL_TYPES.AGENT, {
        sessionId: sessionIdToOpen,
      });
    })().catch((err) => console.error('Startup session restore failed:', err));
    return () => {
      cancelled = true;
    };
  }, [loadPersistedSessions]);

  // Toggle terminal panel, auto-creating a terminal if none exist
  const handleToggleTerminal = useCallback(() => {
    const uiState = useUIStore.getState();
    if (!uiState.terminalPanelOpen) {
      const { terminals } = useTerminalStore.getState();
      if (terminals.size === 0) {
        const cwd = useFileExplorerStore.getState().rootPath ?? undefined;
        createTerminal(cwd)
          .then(({ id, shell }) => {
            useTerminalStore.getState().addTerminal(id, cwd, shell);
            uiState.toggleTerminalPanel();
          })
          .catch((err) => {
            console.error('Failed to create terminal:', err);
          });
        return;
      }
    }
    uiState.toggleTerminalPanel();
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+= / Cmd++ — zoom in (accept both the unshifted '=' and shifted '+')
      if ((e.key === '=' || e.key === '+') && e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        useUIStore.getState().zoomIn();
        return;
      }
      // Cmd+- — zoom out
      if (e.key === '-' && e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        useUIStore.getState().zoomOut();
        return;
      }
      // Cmd+0 — reset zoom
      if (e.key === '0' && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        useUIStore.getState().resetZoom();
        return;
      }

      // Cmd+J — toggle terminal
      if (e.key === 'j' && e.metaKey && !e.shiftKey && !e.ctrlKey) {
        e.preventDefault();
        handleToggleTerminal();
        return;
      }

      // Cmd+B — toggle left sidebar
      if (e.key === 'b' && e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        useUIStore.getState().toggleLeftSidebar();
        return;
      }

      // Ctrl+Shift+` — new terminal session
      // Use e.code because Shift+` produces '~' as e.key
      if (e.code === 'Backquote' && e.ctrlKey && e.shiftKey) {
        e.preventDefault();
        const cwd = useFileExplorerStore.getState().rootPath ?? undefined;
        // Open terminal panel if closed, then create new terminal
        if (!useUIStore.getState().terminalPanelOpen) {
          useUIStore.getState().toggleTerminalPanel();
        }
        createTerminal(cwd)
          .then(({ id, shell }) => {
            useTerminalStore.getState().addTerminal(id, cwd, shell);
          })
          .catch((err) => console.error('Failed to create terminal:', err));
        return;
      }
      // Cmd+, — toggle settings
      if (e.key === ',' && e.metaKey) {
        e.preventDefault();
        if (settingsOpen) {
          closeSettings();
        } else {
          openSettings();
        }
        return;
      }

      // Cmd+N — new agent session
      if (e.key === 'n' && e.metaKey && !e.shiftKey && !e.ctrlKey) {
        e.preventDefault();
        // Don't create sessions when workspace layout isn't visible
        const currentRootPath = useFileExplorerStore.getState().rootPath;
        if (!currentRootPath || settingsOpen) return;
        const model = useProviderStore.getState().selectedModel || undefined;
        useAgentStore.getState().createSession(model)
          .then((newSessionId) => {
            if (newSessionId) {
              usePanelTabsStore.getState().openPanel(BUILTIN_PANEL_TYPES.AGENT, { sessionId: newSessionId });
            }
          })
          .catch((err) => console.error('Failed to create agent session:', err));
        return;
      }

      // Cmd+? (Cmd+Shift+/) -- toggle keyboard shortcuts overlay
      if (e.key === '?' && e.metaKey) {
        e.preventDefault();
        setShortcutsOverlayOpen((prev) => !prev);
        return;
      }

      // Cmd+Shift+T -- toggle tab switcher
      if (e.key === 'T' && e.metaKey && e.shiftKey) {
        e.preventDefault();
        setTabSwitcherOpen((prev) => !prev);
        return;
      }

      // Cmd+W — close current tab (terminal or panel)
      if (e.key === 'w' && e.metaKey && !e.shiftKey) {
        e.preventDefault();
        const isTermOpen = useUIStore.getState().terminalPanelOpen;
        const isEditorActive = document.activeElement?.closest('.monaco-editor');

        if (isTermOpen && !isEditorActive) {
          // Terminal is open and editor is NOT focused → close terminal tab
          const { activeTerminalId: aid } = useTerminalStore.getState();
          if (aid) {
            killTerminal(aid).catch(() => {});
            useTerminalStore.getState().removeTerminal(aid);
            if (useTerminalStore.getState().terminals.size === 0) {
              useUIStore.getState().toggleTerminalPanel();
            }
          }
        } else {
          // Close the active panel tab in the editor tile
          usePanelTabsStore.getState().closeActiveTab(DEFAULT_TILES.editor);
        }
        return;
      }

      // Terminal-specific shortcuts (only when terminal panel is open)
      const isTerminalOpen = useUIStore.getState().terminalPanelOpen;
      if (!isTerminalOpen) return;

      // A6: Don't intercept shortcuts when Monaco editor is focused
      const isEditorFocused = document.activeElement?.closest('.monaco-editor');
      if (isEditorFocused) return;

      // Cmd+T — new terminal
      if (e.key === 't' && e.metaKey && !e.shiftKey) {
        e.preventDefault();
        const cwd = useFileExplorerStore.getState().rootPath ?? undefined;
        createTerminal(cwd)
          .then(({ id, shell }) => {
            useTerminalStore.getState().addTerminal(id, cwd, shell);
          })
          .catch((err) => console.error('Failed to create terminal:', err));
        return;
      }

      // Cmd+Shift+[ or ] — switch terminal tabs
      if (e.key === '[' && e.metaKey && e.shiftKey) {
        e.preventDefault();
        useTerminalStore.getState().cycleTerminal('prev');
        return;
      }
      if (e.key === ']' && e.metaKey && e.shiftKey) {
        e.preventDefault();
        useTerminalStore.getState().cycleTerminal('next');
        return;
      }

      // Cmd+K — clear terminal
      if (e.key === 'k' && e.metaKey && !e.shiftKey) {
        e.preventDefault();
        clearActiveTerminal();
        return;
      }

      // Cmd+F — find in terminal
      if (e.key === 'f' && e.metaKey && !e.shiftKey) {
        e.preventDefault();
        findInActiveTerminal();
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleToggleTerminal, settingsOpen, openSettings, closeSettings]);

  // Open a file in the panel system
  const handleFileOpen = useCallback((path: string) => {
    const fileName = path.split('/').pop() ?? 'Untitled';
    openPanel(BUILTIN_PANEL_TYPES.FILE_VIEWER, { filePath: path, fileName });
  }, [openPanel]);

  // Open Settings > Shortcuts from the overlay
  const handleOpenShortcutsSettings = useCallback(() => {
    setShortcutsOverlayOpen(false);
    openSettings('shortcuts');
  }, [openSettings]);

  // Sidebar resize handlers — direct DOM manipulation for zero-lag dragging.
  // The reactive `isDraggingSidebar` flag is what PrimarySidebar reads to suppress
  // its CSS width transition during the drag (and across the commit on pointerup),
  // preventing the post-release shake caused by transitioning from the React-tracked
  // width to the DOM-tracked width.
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartX.current = e.clientX;
    dragStartWidth.current = useUIStore.getState().leftSidebarWidth;
    document.body.classList.add('is-resizing');
    setIsDraggingSidebar(true);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const delta = e.clientX - dragStartX.current;
    const newWidth = Math.max(SIDEBAR.min, Math.min(SIDEBAR.max, dragStartWidth.current + delta));
    if (sidebarRef.current) {
      sidebarRef.current.style.width = `${newWidth}px`;
    }
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    document.body.classList.remove('is-resizing');
    // Commit final width to store FIRST so the React tree's `width` prop matches
    // the DOM-tracked width before we re-enable transitions on the next frame.
    const delta = e.clientX - dragStartX.current;
    const newWidth = Math.max(SIDEBAR.min, Math.min(SIDEBAR.max, dragStartWidth.current + delta));
    setLeftSidebarWidth(newWidth);
    // Defer clearing the flag until after React has committed the new width, so
    // PrimarySidebar's transition class is still suppressed during the commit
    // that aligns React state with the DOM.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setIsDraggingSidebar(false);
      });
    });
  }, [setLeftSidebarWidth]);

  const handleDoubleClick = useCallback(() => {
    setLeftSidebarWidth(SIDEBAR.expanded);
  }, [setLeftSidebarWidth]);

  // Terminal panel divider drag handlers — pointer capture for zero-lag dragging
  const handleTerminalPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDraggingTerminal(true);
    dragStartY.current = e.clientY;
    dragStartHeight.current = useUIStore.getState().terminalPanelHeight;
    document.body.classList.add('is-resizing-row');
  }, []);

  const handleTerminalPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    // Dragging up increases terminal height
    const delta = dragStartY.current - e.clientY;
    setTerminalPanelHeight(dragStartHeight.current + delta);
  }, [setTerminalPanelHeight]);

  const handleTerminalPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    document.body.classList.remove('is-resizing-row');
    setIsDraggingTerminal(false);
    const delta = dragStartY.current - e.clientY;
    setTerminalPanelHeight(dragStartHeight.current + delta);
  }, [setTerminalPanelHeight]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background text-foreground">
      <header
        data-tauri-drag-region
        style={{ ...titlebarStyle, height: HEIGHTS.titlebar }}
        className="absolute inset-x-0 top-0 z-50 flex items-center"
      >
        <div className="flex items-center gap-1.5" data-tauri-drag-region="false">
          {splashComplete && (rootPath !== null || hasRepos) && (
            <button
              onClick={toggleLeftSidebar}
              data-tauri-drag-region="false"
              className={cn(
                'inline-flex h-8 w-8 items-center justify-center rounded-full',
                'text-sidebar-foreground transition-[background-color,color,transform] duration-150',
                'hover:bg-background/65 hover:text-foreground active:scale-[0.96]',
                !isCollapsed && 'bg-background/50',
              )}
              title={isCollapsed ? 'Open Sidebar (⌘B)' : 'Collapse Sidebar (⌘B)'}
              aria-label={isCollapsed ? 'Open Sidebar' : 'Collapse Sidebar'}
            >
              <PanelLeft className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex-1" data-tauri-drag-region />

        <div className="flex min-w-0 items-center justify-end gap-1.5" data-tauri-drag-region="false">
            {user?.email && (
              <span className="max-w-32 truncate px-1 text-xs text-muted-foreground/70">
                {user.email}
              </span>
            )}
            {splashComplete && (rootPath !== null || hasRepos) && (
              <TitlebarButton
                onClick={handleToggleTerminal}
                icon={<Terminal className={cn('w-4 h-4', terminalPanelOpen ? 'text-primary' : 'text-muted-foreground')} size={16} />}
                label="Terminal"
                active={terminalPanelOpen}
                title="Toggle Terminal (⌘J)"
              />
            )}
            <TitlebarButton
              onClick={() => setBugReportOpen(true)}
              icon={<Bug className="w-4 h-4 text-muted-foreground" size={16} />}
              label="Report Bug"
              title="Report a Bug"
            />
            <TitlebarButton
              onClick={() => openSettings()}
              icon={<GearIcon className="w-4 h-4 text-muted-foreground" />}
              label="Settings"
              title="Settings (⌘,)"
            />
            <TitlebarButton
              onClick={signOut}
              icon={<ExitIcon className="w-4 h-4 text-muted-foreground" />}
              label="Sign Out"
              title="Sign out"
            />
        </div>
      </header>

      <div className="flex h-full min-h-0 flex-col">
        <AnimatePresence mode="popLayout">
          {settingsOpen ? (
            <motion.div
              key="settings"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.25, ease: EASE_SMOOTH }}
              className="flex min-h-0 flex-1"
              style={{ paddingTop: HEIGHTS.titlebar }}
            >
              <SettingsView />
            </motion.div>
          ) : (
            <motion.div
              key="workspace"
              initial={{ opacity: 0, x: -24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.25, ease: EASE_SMOOTH }}
              className="flex min-h-0 flex-1"
            >
              <DndProvider backend={HTML5Backend}>
                {splashComplete && hasRepos ? <RepoRail /> : null}

                {splashComplete && (
                  <>
                    <PrimarySidebar
                      ref={sidebarRef}
                      width={leftSidebarWidth}
                      isResizing={isDraggingSidebar}
                      onFileOpen={handleFileOpen}
                    />

                    {!isCollapsed ? (
                      <div
                        className="split-divider"
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onDoubleClick={handleDoubleClick}
                      />
                    ) : null}
                  </>
                )}

                <div
                  className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background"
                  style={{ paddingTop: HEIGHTS.titlebar }}
                >
                  {splashComplete && (rootPath !== null || sidebarMode === 'vault') ? (
                    <>
                      <div className="min-h-0 flex-1 overflow-hidden">
                        <MosaicLayout />
                      </div>

                      <div className={cn(
                        'grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
                        terminalPanelOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                      )}>
                        <div className="min-h-0 overflow-hidden">
                          <div
                            className={cn(
                              'h-1.5 shrink-0 cursor-row-resize flex items-center justify-center hover:bg-foreground/[0.06] transition-colors',
                              isDraggingTerminal && 'bg-foreground/[0.08]',
                            )}
                            onPointerDown={handleTerminalPointerDown}
                            onPointerMove={handleTerminalPointerMove}
                            onPointerUp={handleTerminalPointerUp}
                          >
                            <div className="h-[2px] w-10 rounded-full bg-border/70" />
                          </div>

                          <div
                            className="overflow-hidden"
                            style={{ height: terminalPanelHeight }}
                          >
                            <SidebarTerminal />
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <WelcomeScreen onProjectOpen={() => setSplashComplete(true)} />
                  )}
                </div>
              </DndProvider>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <KeyboardShortcutsOverlay
        open={shortcutsOverlayOpen}
        onOpenChange={setShortcutsOverlayOpen}
        onOpenSettings={handleOpenShortcutsSettings}
      />
      {bugReportOpen && <BugReportDialog onClose={() => setBugReportOpen(false)} />}
      <TabSwitcher open={tabSwitcherOpen} onClose={() => setTabSwitcherOpen(false)} />
      <SkillsOnboardingDialog />
      <Toaster richColors position="bottom-right" theme={resolvedTheme} />
    </div>
  );
}

function App() {
  return (
    <AuthGuard>
      <AppContent />
    </AuthGuard>
  );
}

export default App;
