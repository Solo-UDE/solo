import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GitBranch } from "lucide-react";
import { PrimarySidebar } from "./components/sidebar";
import { MosaicLayout } from "./components/panels";
import { useFileExplorerStore } from "./stores/fileExplorerStore";
import { useUIStore } from "./stores/uiStore";
import { usePanelTabsStore } from "./stores/panelTabsStore";
import { registerBuiltinPanels, BUILTIN_PANEL_TYPES } from "./lib/panels";

// Register built-in panels on module load
registerBuiltinPanels();

function App() {
  const [backendStatus, setBackendStatus] = useState<string>("Connecting...");

  const rootPath = useFileExplorerStore((s) => s.rootPath);
  const leftSidebarWidth = useUIStore((state) => state.leftSidebarWidth);

  // Get openPanel action directly from store to avoid selector subscription issues
  const openPanel = useMemo(() => usePanelTabsStore.getState().openPanel, []);

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

  // Open a file in the panel system
  const handleFileOpen = useCallback((path: string) => {
    const fileName = path.split('/').pop() ?? 'Untitled';
    openPanel(BUILTIN_PANEL_TYPES.FILE_VIEWER, { filePath: path, fileName });
  }, [openPanel]);

  return (
    <div className="h-screen w-screen bg-background text-foreground flex flex-col overflow-hidden">
      {/* Titlebar drag region */}
      <div
        data-tauri-drag-region
        className="h-12 flex items-center px-4 bg-card/80 backdrop-blur-sm border-b border-border/30 shrink-0"
      >
        <div className="flex-1" data-tauri-drag-region>
          <span className="text-sm font-medium text-muted-foreground">Solo</span>
        </div>
        {/* Backend status indicator */}
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

      {/* Status bar */}
      <div className="h-6 px-3 bg-primary border-t border-border/30 flex items-center justify-between shrink-0 text-xs text-primary-foreground">
        {/* Left section: branch info */}
        <div className="flex items-center gap-4">
          {rootPath && (
            <span className="flex items-center gap-1.5">
              <GitBranch className="w-3.5 h-3.5" />
              main
            </span>
          )}
          {!rootPath && <span>Ready</span>}
        </div>

        {/* Right section */}
        <div className="flex items-center gap-4">
          <span>UTF-8</span>
        </div>
      </div>
    </div>
  );
}

export default App;
