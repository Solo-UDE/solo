import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PrimarySidebar } from "./components/sidebar";
import { FileViewer } from "./components/editor";
import { useFileExplorerStore } from "./stores/fileExplorerStore";
import { useUIStore } from "./stores/uiStore";

function App() {
  const [backendStatus, setBackendStatus] = useState<string>("Connecting...");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const rootPath = useFileExplorerStore((s) => s.rootPath);
  const openFolder = useFileExplorerStore((s) => s.openFolder);
  const leftSidebarWidth = useUIStore((state) => state.leftSidebarWidth);

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

  const handleFileOpen = useCallback((path: string) => {
    setSelectedFile(path);
    console.log("File opened:", path);
  }, []);

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

        {/* Main editor area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {rootPath ? (
            // Show file viewer when a folder is open
            <FileViewer filePath={selectedFile} className="flex-1" />
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
