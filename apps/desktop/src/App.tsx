import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GearSix, SignOut, Terminal, IconContext } from "@phosphor-icons/react";
import { PrimarySidebar } from "./components/sidebar";
import { SidebarTerminal } from "./components/sidebar";
import { MosaicLayout } from "./components/panels";
import { AuthGuard } from "./components/auth";
import { useUIStore } from "./stores/uiStore";
import { usePanelTabsStore } from "./stores/panelTabsStore";
import { useProviderStore } from "./stores/provider-store";
import { useAgentStore } from "./stores/agentStore";
import { useAuthStore, useUser } from "./stores/authStore";
import { registerBuiltinPanels, BUILTIN_PANEL_TYPES } from "./lib/panels";
import { SettingsModal } from "./components/settings";
import { useAutosave } from "./hooks/useAutosave";
import { useColorScheme } from "./hooks/useColorScheme";
import { useTitlebarStyle } from "./hooks/usePlatform";
import { useAgentStream } from "./hooks/useAgentStream";
import { useTerminalStream } from "./hooks/useTerminalStream";
import { useTerminalStore } from "./stores/terminalStore";
import { useFileExplorerStore } from "./stores/fileExplorerStore";
import { createTerminal } from "./lib/tauri/terminal";
import { SIDEBAR } from "./lib/constants";
import { cn } from "./lib/utils";

// Register built-in panels on module load
registerBuiltinPanels();

function AppContent() {
  const [backendStatus, setBackendStatus] = useState<string>("Connecting...");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef<number>(0);
  const dragStartWidth = useRef<number>(0);

  // Terminal panel drag state
  const [isDraggingTerminal, setIsDraggingTerminal] = useState(false);
  const dragStartY = useRef<number>(0);
  const dragStartHeight = useRef<number>(0);

  const leftSidebarWidth = useUIStore((state) => state.leftSidebarWidth);
  const setLeftSidebarWidth = useUIStore((state) => state.setLeftSidebarWidth);
  const terminalPanelOpen = useUIStore((s) => s.terminalPanelOpen);
  const terminalPanelHeight = useUIStore((s) => s.terminalPanelHeight);
  const setTerminalPanelHeight = useUIStore((s) => s.setTerminalPanelHeight);
  const initializeProviders = useProviderStore((state) => state.initialize);
  const loadPersistedSessions = useAgentStore((state) => state.loadPersistedSessions);
  const signOut = useAuthStore((state) => state.signOut);
  const user = useUser();

  // Get openPanel action directly from store to avoid selector subscription issues
  const openPanel = useMemo(() => usePanelTabsStore.getState().openPanel, []);

  // Enable autosave on blur and tab switch
  useAutosave();

  // Apply color scheme to document
  useColorScheme();

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

  // Load persisted agent sessions on startup
  useEffect(() => {
    loadPersistedSessions();
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

  // Keyboard shortcut: Ctrl+` (Cmd+` on Mac) to toggle terminal panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '`' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleToggleTerminal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleToggleTerminal]);

  // Open a file in the panel system
  const handleFileOpen = useCallback((path: string) => {
    const fileName = path.split('/').pop() ?? 'Untitled';
    openPanel(BUILTIN_PANEL_TYPES.FILE_VIEWER, { filePath: path, fileName });
  }, [openPanel]);

  // Sidebar resize handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartX.current = e.clientX;
    dragStartWidth.current = leftSidebarWidth;
  }, [leftSidebarWidth]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    const delta = e.clientX - dragStartX.current;
    const newWidth = Math.max(SIDEBAR.min, Math.min(SIDEBAR.max, dragStartWidth.current + delta));
    setLeftSidebarWidth(newWidth);
  }, [isDragging, setLeftSidebarWidth]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDoubleClick = useCallback(() => {
    setLeftSidebarWidth(SIDEBAR.expanded);
  }, [setLeftSidebarWidth]);

  // Attach global mouse events for sidebar drag
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Terminal panel divider drag handlers
  const handleTerminalDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingTerminal(true);
    dragStartY.current = e.clientY;
    dragStartHeight.current = terminalPanelHeight;
  }, [terminalPanelHeight]);

  const handleTerminalDragMove = useCallback((e: MouseEvent) => {
    if (!isDraggingTerminal) return;
    // Dragging up increases terminal height
    const delta = dragStartY.current - e.clientY;
    setTerminalPanelHeight(dragStartHeight.current + delta);
  }, [isDraggingTerminal, setTerminalPanelHeight]);

  const handleTerminalDragEnd = useCallback(() => {
    setIsDraggingTerminal(false);
  }, []);

  // Attach global mouse events for terminal divider drag
  useEffect(() => {
    if (isDraggingTerminal) {
      document.addEventListener('mousemove', handleTerminalDragMove);
      document.addEventListener('mouseup', handleTerminalDragEnd);
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    }
    return () => {
      document.removeEventListener('mousemove', handleTerminalDragMove);
      document.removeEventListener('mouseup', handleTerminalDragEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDraggingTerminal, handleTerminalDragMove, handleTerminalDragEnd]);

  return (
    <div className="h-screen w-screen bg-background text-foreground overflow-hidden relative">
      {/* Titlebar overlay — floats above full-height content */}
      <div
        data-tauri-drag-region
        style={titlebarStyle}
        className="absolute top-0 inset-x-0 h-[38px] flex items-center z-50 backdrop-blur-md bg-background/70"
      >
        <div className="flex-1" data-tauri-drag-region />

        <span className="text-xs font-medium text-muted-foreground/60" data-tauri-drag-region>
          Solo
        </span>

        <div className="flex-1 flex items-center justify-end gap-1.5">
          <div
            className={`w-1.5 h-1.5 rounded-full ${
              backendStatus.includes("connected")
                ? "bg-status-success"
                : backendStatus.includes("error")
                  ? "bg-status-error"
                  : "bg-status-warning animate-pulse"
            }`}
          />
          {user?.email && (
            <span className="text-[11px] text-muted-foreground/70 truncate max-w-28">
              {user.email}
            </span>
          )}
          <button
            onClick={handleToggleTerminal}
            className={cn(
              'p-1 rounded hover:bg-foreground/[0.08] transition-colors',
              terminalPanelOpen && 'bg-foreground/[0.08]',
            )}
            title="Toggle Terminal (⌘`)"
          >
            <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-1 rounded hover:bg-foreground/[0.08] transition-colors"
            title="Settings"
          >
            <GearSix className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
          <button
            onClick={signOut}
            className="p-1 rounded hover:bg-foreground/[0.08] transition-colors"
            title="Sign out"
          >
            <SignOut className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Full-height content — sidebar bg extends behind titlebar */}
      <div className="flex h-full">
        <PrimarySidebar width={leftSidebarWidth} onFileOpen={handleFileOpen} />

        <div
          className={cn('split-divider', isDragging && 'dragging')}
          onMouseDown={handleMouseDown}
          onDoubleClick={handleDoubleClick}
        >
          <div className="split-divider-grip">
            <span /><span /><span />
          </div>
        </div>

        {/* Right column: content pushed below titlebar */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0 pt-[38px]">
          <div className="flex-1 overflow-hidden min-h-0">
            <MosaicLayout />
          </div>

          {terminalPanelOpen && (
            <>
              <div
                className={cn(
                  'h-1.5 shrink-0 cursor-row-resize flex items-center justify-center hover:bg-primary/20 transition-colors',
                  isDraggingTerminal && 'bg-primary/30',
                )}
                onMouseDown={handleTerminalDragStart}
              >
                <div className="w-8 h-px bg-border/60 rounded-full" />
              </div>

              <div
                className="shrink-0 overflow-hidden"
                style={{ height: terminalPanelHeight }}
              >
                <SidebarTerminal />
              </div>
            </>
          )}
        </div>
      </div>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
}

function App() {
  return (
    <IconContext.Provider value={{ weight: "fill" }}>
      <AuthGuard>
        <AppContent />
      </AuthGuard>
    </IconContext.Provider>
  );
}

export default App;
