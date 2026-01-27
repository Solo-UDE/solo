import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GitBranch, Settings } from "lucide-react";
import { PrimarySidebar } from "./components/sidebar";
import { CodeEditor, EditorErrorBoundary } from "./components/editor";
import { useFileExplorerStore } from "./stores/fileExplorerStore";
import { useUIStore } from "./stores/uiStore";
import { useEditorStore, useActiveTabStatus } from "./stores/editorStore";
import { SettingsModal } from "./components/settings";
import { useAutosave } from "./hooks/useAutosave";

function App() {
  const rootPath = useFileExplorerStore((s) => s.rootPath);
  const openFolder = useFileExplorerStore((s) => s.openFolder);
  const leftSidebarWidth = useUIStore((state) => state.leftSidebarWidth);

  const activeTab = useEditorStore((s) => s.activeTab);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Status bar info for active file
  const tabStatus = useActiveTabStatus();

  // Enable autosave on blur and tab switch
  useAutosave();

  useEffect(() => {
    // Test IPC connection with ping
    invoke<string>("ping")
      .then((response) => {
        console.log("Backend connected:", response);
      })
      .catch((err) => {
        console.error("Backend error:", err);
      });
  }, []);

  const handleFileOpen = useCallback(
    (path: string) => {
      // Set as active tab - CodeEditor will load it if needed
      setActiveTab(path);
    },
    [setActiveTab]
  );

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
        <button
          onClick={() => setIsSettingsOpen(true)}
          className="p-1.5 rounded hover:bg-muted transition-colors"
          title="Settings"
        >
          <Settings className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Dynamic-width sidebar */}
        <PrimarySidebar width={leftSidebarWidth} onFileOpen={handleFileOpen} />

        {/* Main editor area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {rootPath ? (
            <EditorErrorBoundary>
              <CodeEditor filePath={activeTab} className="flex-1" />
            </EditorErrorBoundary>
          ) : (
            // Show welcome screen when no folder is open
            <div className="flex-1 flex items-center justify-center bg-background">
              <div className="text-center space-y-6">
                <div className="space-y-2">
                  <h1 className="text-4xl font-bold tracking-tight text-foreground">Solo IDE</h1>
                  <p className="text-muted-foreground">AI-native development environment</p>
                </div>

                <div className="pt-8 flex gap-3 justify-center">
                  <button className="h-10 px-5 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 active:scale-[0.97] transition-all duration-200">
                    New Project
                  </button>
                  <button
                    onClick={openFolder}
                    className="h-10 px-5 bg-secondary text-secondary-foreground rounded-md font-medium hover:bg-secondary/80 active:scale-[0.97] transition-all duration-200"
                  >
                    Open Folder
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Unified status bar */}
      <div className="h-6 px-3 bg-primary border-t border-border/30 flex items-center justify-between shrink-0 text-xs text-primary-foreground">
        {/* Left section: branch + file info */}
        <div className="flex items-center gap-4">
          {rootPath && (
            <span className="flex items-center gap-1.5">
              <GitBranch className="w-3.5 h-3.5" />
              main
            </span>
          )}
          {tabStatus && (
            <>
              <span>{tabStatus.language}</span>
              <span>UTF-8</span>
              {tabStatus.isDirty && (
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-foreground/80 animate-pulse" />
                  Modified
                </span>
              )}
            </>
          )}
          {!rootPath && !tabStatus && <span>Ready</span>}
        </div>

        {/* Right section: cursor position + line count */}
        <div className="flex items-center gap-4">
          {tabStatus && (
            <>
              <span>
                Ln {tabStatus.cursorPosition.line}, Col {tabStatus.cursorPosition.col}
              </span>
              {tabStatus.lineCount > 0 && <span>{tabStatus.lineCount} lines</span>}
            </>
          )}
        </div>
      </div>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
}

export default App;
