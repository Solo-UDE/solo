import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PrimarySidebar } from "./components/sidebar";
import { FileViewer } from "./components/editor";
import { AgentWindow } from "./components/agent";
import { useFileExplorerStore } from "./stores/fileExplorerStore";
import { useUIStore } from "./stores/uiStore";
import { useProviderStore } from "./stores/provider-store";

function App() {
  const [backendStatus, setBackendStatus] = useState<string>("Connecting...");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const rootPath = useFileExplorerStore((s) => s.rootPath);
  const openFolder = useFileExplorerStore((s) => s.openFolder);
  const leftSidebarWidth = useUIStore((state) => state.leftSidebarWidth);
  const mainPanelType = useUIStore((state) => state.mainPanelType);
  const setMainPanelType = useUIStore((state) => state.setMainPanelType);
  const initializeProviders = useProviderStore((state) => state.initialize);

  useEffect(() => {
    // Test IPC connection with ping
    invoke<string>("ping")
      .then((response) => {
        setBackendStatus(`Backend connected: ${response}`);
      })
      .catch((err) => {
        setBackendStatus(`Backend error: ${err}`);
      });
  }, []);

  // Initialize provider store on startup
  useEffect(() => {
    initializeProviders().catch((err) => {
      console.error("Failed to initialize providers:", err);
    });
  }, [initializeProviders]);

  const handleFileOpen = useCallback((path: string) => {
    setSelectedFile(path);
    setMainPanelType('file');
    console.log("File opened:", path);
  }, [setMainPanelType]);

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
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Dynamic-width sidebar */}
        <PrimarySidebar width={leftSidebarWidth} onFileOpen={handleFileOpen} />

        {/* Main content area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Agent Window - when sessions tab active and agent panel selected */}
          {mainPanelType === 'agent' && (
            <AgentWindow
              instanceId="main-agent"
              className="flex-1"
              ui={{
                showHeader: true,
                showModelSelector: true,
                showModeSelector: true,
                agentName: 'Claude',
              }}
            />
          )}

          {/* File Viewer - when a file is selected */}
          {mainPanelType === 'file' && selectedFile && (
            <FileViewer filePath={selectedFile} className="flex-1" />
          )}

          {/* Empty state - when no panel type or file viewer without file */}
          {(mainPanelType === 'empty' || (mainPanelType === 'file' && !selectedFile)) && (
            rootPath ? (
              // Show file selection prompt when folder is open
              <FileViewer filePath={null} className="flex-1" />
            ) : (
              // Show welcome screen when no folder is open
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center space-y-6">
                  <div className="space-y-2">
                    <h1 className="text-4xl font-bold tracking-tight">Solo IDE</h1>
                    <p className="text-muted-foreground">AI-native development environment</p>
                  </div>

                  <div className="inline-flex items-center gap-2 px-4 py-2 bg-card rounded-xl shadow-lg">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        backendStatus.includes("connected")
                          ? "bg-status-success"
                          : backendStatus.includes("error")
                            ? "bg-status-error"
                            : "bg-status-warning animate-pulse"
                      }`}
                    />
                    <span className="text-sm text-muted-foreground">{backendStatus}</span>
                  </div>

                  <div className="pt-8 flex gap-3 justify-center">
                    <button className="h-10 px-5 bg-primary text-primary-foreground rounded-xl font-medium hover:brightness-110 active:scale-[0.97] transition-all duration-200">
                      New Project
                    </button>
                    <button
                      onClick={openFolder}
                      className="h-10 px-5 bg-muted/60 text-foreground rounded-xl font-medium hover:bg-muted active:scale-[0.97] transition-all duration-200"
                    >
                      Open Folder
                    </button>
                  </div>
                </div>
              </div>
            )
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="h-6 px-3 bg-card/60 border-t border-border/30 flex items-center shrink-0">
        <span className="text-xs text-muted-foreground">
          {rootPath ? `Workspace: ${rootPath}` : "Ready"}
        </span>
      </div>
    </div>
  );
}

export default App;
