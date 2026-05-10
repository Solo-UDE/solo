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
import { usePanelLayoutStore } from "./stores/panelLayoutStore";
import { usePanelTabsStore } from "./stores/panelTabsStore";
import { useProviderStore } from "./stores/provider-store";
import { useAgentStore } from "./stores/agentStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useAuthStore, useUser } from "./stores/authStore";
import { registerBuiltinPanels, BUILTIN_PANEL_TYPES, DEFAULT_TILES } from "./lib/panels";
import { SettingsView } from "./components/settings";
import { useAutosave } from "./hooks/useAutosave";
import { useAppZoom } from "./hooks/useAppZoom";
import { useAppearanceTheme } from "./hooks/useAppearanceTheme";
import { useColorScheme } from "./hooks/useColorScheme";
import { useTitlebarStyle } from "./hooks/usePlatform";
import { useVoiceStore } from "./stores/voiceStore";
import { voiceApi } from "./lib/tauri/voice";
import { useAgentStream } from "./hooks/useAgentStream";
import { useTerminalStream } from "./hooks/useTerminalStream";
import { useGitStream } from "./hooks/useGitStream";
import { useWorktreeStream } from "./hooks/useWorktreeStream";
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
import { stopStartupSound } from "./hooks/useStartupSound";
import { KeyboardShortcutsOverlay } from "./components/KeyboardShortcutsOverlay";
import { BugReportDialog } from "./components/bug-report/BugReportDialog";
import { TabSwitcher } from "./components/panels/TabSwitcher";
import { SkillsOnboardingDialog } from "./components/agent/SkillsOnboardingDialog";
import { GlobalTitleTooltip } from "./components/shared/GlobalTitleTooltip";
import { getEffectiveKeybinding, matchesKeybinding } from "./lib/keybindings";
import { scheduleInteractionPrewarm } from "./lib/prewarm";
import { settleAfterPaint, trace } from "./lib/perf";

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
  const customKeybindings = useSettingsStore((s) => s.shortcuts.keybindings);

  // Get openPanel action directly from store to avoid selector subscription issues
  const openPanel = useMemo(() => usePanelTabsStore.getState().openPanel, []);

  // Enable autosave on blur and tab switch
  useAutosave();

  // Apply persisted zoom level to the webview, react to Cmd+=/Cmd+-/Cmd+0 changes
  useAppZoom();

  // On window focus: if a voice-dispatched agent session is pending, open it in
  // the agent panel and clear the dock badge. This gives a "no focus-steal"
  // experience — the session is queued while Solo is in the background and
  // surfaces automatically the next time the user switches to Solo.
  useEffect(() => {
    const handleFocus = () => {
      const pending = useVoiceStore.getState().pendingDispatch;
      if (!pending) return;
      // Open the dispatched session in the agent panel
      usePanelTabsStore.getState().openPanel(BUILTIN_PANEL_TYPES.AGENT, {
        sessionId: pending.session_id,
      });
      // Clear the pending state so we don't re-open on subsequent focus events
      useVoiceStore.getState().setPendingDispatch(null);
      // Clear the macOS dock badge
      voiceApi.clearBadge().catch((err) =>
        console.warn('voice_clear_badge failed:', err),
      );
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

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
  useAppearanceTheme(resolvedTheme);

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
  useUpdateStream();
  useVaultStream();

  useEffect(() => {
    scheduleInteractionPrewarm();
  }, []);

  useEffect(() => {
    if (!splashComplete && (rootPath !== null || hasRepos)) {
      stopStartupSound();
      setSplashComplete(true);
    }
  }, [hasRepos, rootPath, splashComplete]);

  // Load GitHub token linked to the current Solo account so the header shows auth status
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

  const handleSettingsToggle = useCallback((detail: string, tab?: Parameters<typeof openSettings>[0]) => {
    const perf = trace(settingsOpen ? 'settings.close' : 'settings.open', detail);
    if (settingsOpen) {
      closeSettings();
    } else {
      openSettings(tab);
    }
    perf.endHandler();
    settleAfterPaint(perf);
  }, [closeSettings, openSettings, settingsOpen]);

  const handleCreateTerminal = useCallback(() => {
    const cwd = useFileExplorerStore.getState().rootPath ?? undefined;

    if (!useUIStore.getState().terminalPanelOpen) {
      useUIStore.getState().toggleTerminalPanel();
    }

    createTerminal(cwd)
      .then(({ id, shell }) => {
        useTerminalStore.getState().addTerminal(id, cwd, shell);
      })
      .catch((err) => console.error('Failed to create terminal:', err));
  }, []);

  const handleCycleWorkspace = useCallback((direction: 'next' | 'prev') => {
    const { repos, activeRepoPath } = useRepoStore.getState();
    const repoList = Array.from(repos.values());

    if (repoList.length < 2) return;

    const currentIndex = activeRepoPath
      ? repoList.findIndex((repo) => repo.path === activeRepoPath)
      : -1;

    const nextIndex = currentIndex === -1
      ? 0
      : direction === 'next'
        ? (currentIndex + 1) % repoList.length
        : (currentIndex - 1 + repoList.length) % repoList.length;

    const targetRepo = repoList[nextIndex];
    if (!targetRepo) return;

    void useRepoStore.getState().selectWorktree(targetRepo.path, null);
  }, []);

  const handleSwitchWorktreeSlot = useCallback(async (slotIndex: number) => {
    const repoStore = useRepoStore.getState();
    const activeRepoPath = repoStore.activeRepoPath;
    if (!activeRepoPath) return;

    let repo = repoStore.repos.get(activeRepoPath);
    if (!repo) return;

    if (!repo._worktreesLoaded) {
      await repoStore.refreshWorktrees(activeRepoPath);
      repo = useRepoStore.getState().repos.get(activeRepoPath);
      if (!repo) return;
    }

    const orderedWorktreeIds = [
      null,
      ...repo.worktrees.filter((worktree) => !worktree.is_main).map((worktree) => worktree.id),
    ];

    const targetWorktreeId = orderedWorktreeIds[slotIndex];
    if (targetWorktreeId === undefined) return;

    await repoStore.selectWorktree(activeRepoPath, targetWorktreeId);
  }, []);

  const matchAction = useCallback(
    (actionId: string, e: KeyboardEvent) => {
      const keybinding = getEffectiveKeybinding(actionId, customKeybindings);
      return Boolean(keybinding) && matchesKeybinding(keybinding, e);
    },
    [customKeybindings]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isEditorFocused = Boolean(document.activeElement?.closest('.monaco-editor'));
      const isTerminalOpen = useUIStore.getState().terminalPanelOpen;
      const targetTileId = usePanelLayoutStore.getState().focusedTileId || DEFAULT_TILES.editor;

      if (matchAction('view.zoomIn', e)) {
        e.preventDefault();
        useUIStore.getState().zoomIn();
        return;
      }

      if (matchAction('view.zoomOut', e)) {
        e.preventDefault();
        useUIStore.getState().zoomOut();
        return;
      }

      if (matchAction('view.resetZoom', e)) {
        e.preventDefault();
        useUIStore.getState().resetZoom();
        return;
      }

      if (matchAction('nav.nextWorkspace', e)) {
        e.preventDefault();
        handleCycleWorkspace('next');
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
        handleCycleWorkspace('prev');
        return;
      }

      for (let slot = 1; slot <= 9; slot += 1) {
        if (matchAction(`nav.focusWorktree${slot}`, e)) {
          e.preventDefault();
          void handleSwitchWorktreeSlot(slot - 1);
          return;
        }
      }

      for (let slot = 1; slot <= 9; slot += 1) {
        if (matchAction(`nav.focusTab${slot}`, e)) {
          e.preventDefault();
          usePanelTabsStore.getState().activateTabByIndex(targetTileId, slot - 1);
          return;
        }
      }

      if (matchAction('view.toggleTerminal', e)) {
        e.preventDefault();
        handleToggleTerminal();
        return;
      }

      if (matchAction('view.toggleSidebar', e)) {
        e.preventDefault();
        useUIStore.getState().toggleLeftSidebar();
        return;
      }

      if (matchAction('terminal.newSession', e)) {
        e.preventDefault();
        handleCreateTerminal();
        return;
      }

      if (matchAction('settings.open', e)) {
        e.preventDefault();
        handleSettingsToggle('keyboard');
        return;
      }

      if (matchAction('agent.newSession', e)) {
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

      if (matchAction('view.showShortcuts', e)) {
        e.preventDefault();
        setShortcutsOverlayOpen((prev) => !prev);
        return;
      }

      if (matchAction('nav.tabSwitcher', e)) {
        e.preventDefault();
        setTabSwitcherOpen((prev) => !prev);
        return;
      }

      if (matchAction('file.closeTab', e)) {
        e.preventDefault();
        if (isTerminalOpen && !isEditorFocused) {
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
          // Close the active panel tab in the focused tile
          usePanelTabsStore.getState().closeActiveTab(targetTileId);
        }
        return;
      }

      if (matchAction('nav.prevTab', e)) {
        e.preventDefault();
        if (isTerminalOpen && !isEditorFocused) {
          useTerminalStore.getState().cycleTerminal('prev');
        } else {
          usePanelTabsStore.getState().activatePrevTab(targetTileId);
        }
        return;
      }

      if (matchAction('nav.nextTab', e)) {
        e.preventDefault();
        if (isTerminalOpen && !isEditorFocused) {
          useTerminalStore.getState().cycleTerminal('next');
        } else {
          usePanelTabsStore.getState().activateNextTab(targetTileId);
        }
        return;
      }

      if (matchAction('terminal.new', e)) {
        e.preventDefault();
        handleCreateTerminal();
        return;
      }

      if (!isTerminalOpen || isEditorFocused) return;

      if (matchAction('terminal.clear', e)) {
        e.preventDefault();
        clearActiveTerminal();
        return;
      }

      if (matchAction('editor.find', e)) {
        e.preventDefault();
        findInActiveTerminal();
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    handleCreateTerminal,
    handleCycleWorkspace,
    handleSettingsToggle,
    handleSwitchWorktreeSlot,
    handleToggleTerminal,
    matchAction,
    settingsOpen,
  ]);

  // Open a file in the panel system
  const handleFileOpen = useCallback((path: string) => {
    const fileName = path.split('/').pop() ?? 'Untitled';
    const perf = trace('file.open', fileName);
    openPanel(BUILTIN_PANEL_TYPES.FILE_VIEWER, { filePath: path, fileName });
    perf.endHandler();
    settleAfterPaint(perf);
  }, [openPanel]);

  // Open Settings > Shortcuts from the overlay
  const handleOpenShortcutsSettings = useCallback(() => {
    const perf = trace('settings.open', 'shortcuts-overlay');
    setShortcutsOverlayOpen(false);
    openSettings('shortcuts');
    perf.endHandler();
    settleAfterPaint(perf);
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
              onClick={() => handleSettingsToggle('titlebar')}
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
        <div
          className={cn(
            'flex min-h-0 flex-1',
            settingsOpen && 'pointer-events-none select-none',
          )}
          aria-hidden={settingsOpen}
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
              className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background rounded-tl-xl rounded-bl-xl"
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
                          'h-1.5 shrink-0 cursor-row-resize flex items-center justify-center hover:bg-foreground/[0.06] transition-[background-color] duration-150',
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
        </div>
      </div>

      <AnimatePresence initial={false}>
        {settingsOpen && (
          <motion.div
            key="settings-overlay"
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2 }}
            transition={{ duration: 0.1, ease: [0.2, 0, 0, 1] }}
            className="absolute inset-0 z-40 flex min-h-0 bg-background"
            style={{ paddingTop: HEIGHTS.titlebar }}
          >
            <SettingsView />
          </motion.div>
        )}
      </AnimatePresence>

      <KeyboardShortcutsOverlay
        open={shortcutsOverlayOpen}
        onOpenChange={setShortcutsOverlayOpen}
        onOpenSettings={handleOpenShortcutsSettings}
      />
      {bugReportOpen && <BugReportDialog onClose={() => setBugReportOpen(false)} />}
      <TabSwitcher open={tabSwitcherOpen} onClose={() => setTabSwitcherOpen(false)} />
      <SkillsOnboardingDialog />
      <GlobalTitleTooltip />
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
