import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Settings } from "lucide-react";
import { PrimarySidebar } from "./components/sidebar";
import { MosaicLayout } from "./components/panels";
import { useUIStore } from "./stores/uiStore";
import { usePanelTabsStore } from "./stores/panelTabsStore";
import { useProviderStore } from "./stores/provider-store";
import { useAgentStore } from "./stores/agentStore";
import { registerBuiltinPanels, BUILTIN_PANEL_TYPES } from "./lib/panels";
import { SettingsModal } from "./components/settings";
import { useAutosave } from "./hooks/useAutosave";
import { useColorScheme } from "./hooks/useColorScheme";
import { useTitlebarStyle } from "./hooks/usePlatform";

// Register built-in panels on module load
registerBuiltinPanels();

function App() {
  const [backendStatus, setBackendStatus] = useState<string>("Connecting...");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const leftSidebarWidth = useUIStore((state) => state.leftSidebarWidth);
  const initializeProviders = useProviderStore((state) => state.initialize);
  const loadPersistedSessions = useAgentStore((state) => state.loadPersistedSessions);

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

  // Load persisted agent sessions on startup
  useEffect(() => {
    loadPersistedSessions();
  }, [loadPersistedSessions]);

  // Open a file in the panel system
  const handleFileOpen = useCallback((path: string) => {
    const fileName = path.split('/').pop() ?? 'Untitled';
    openPanel(BUILTIN_PANEL_TYPES.FILE_VIEWER, { filePath: path, fileName });
  }, [openPanel]);

  return (
    <div className="h-screen w-screen bg-background text-foreground flex flex-col overflow-hidden">
      {/* Titlebar drag region - padding adjusts for platform window controls */}
      <div
        data-tauri-drag-region
        style={titlebarStyle}
        className="h-12 flex items-center bg-card/80 backdrop-blur-sm border-b border-border/30 shrink-0"
      >
        <div className="flex-1" data-tauri-drag-region>
          <span className="text-sm font-medium text-muted-foreground">Solo</span>
        </div>
        {/* Settings button and status indicator */}
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              backendStatus.includes("connected")
                ? "bg-status-success"
                : backendStatus.includes("error")
                  ? "bg-status-error"
                  : "bg-status-warning animate-pulse"
            }`}
          />
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-1.5 rounded hover:bg-muted transition-colors"
            title="Settings"
          >
            <Settings className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Dynamic-width sidebar */}
        <PrimarySidebar width={leftSidebarWidth} onFileOpen={handleFileOpen} />

        {/* Main editor area with panel system */}
        <div className="flex-1 overflow-hidden">
          <MosaicLayout />
        </div>
      </div>

      {/* Settings modal */}
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
}

export default App;
