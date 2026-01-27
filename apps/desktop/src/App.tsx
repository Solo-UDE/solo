import { useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PrimarySidebar } from "./components/sidebar";
import { CodeEditor, EditorErrorBoundary } from "./components/editor";
import { useFileExplorerStore } from "./stores/fileExplorerStore";
import { useUIStore } from "./stores/uiStore";
import { useEditorStore } from "./stores/editorStore";

function App() {
  const rootPath = useFileExplorerStore((s) => s.rootPath);
  const openFolder = useFileExplorerStore((s) => s.openFolder);
  const leftSidebarWidth = useUIStore((state) => state.leftSidebarWidth);

  const activeTab = useEditorStore((s) => s.activeTab);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);

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
            <div className="flex-1 flex items-center justify-center bg-[#1e1e1e]">
              <div className="text-center space-y-6">
                <div className="space-y-2">
                  <h1 className="text-4xl font-bold tracking-tight text-white">Solo IDE</h1>
                  <p className="text-[#8b8b8b]">AI-native development environment</p>
                </div>

                <div className="pt-8 flex gap-3 justify-center">
                  <button className="h-10 px-5 bg-[#007acc] text-white rounded font-medium hover:bg-[#1c8ad4] active:scale-[0.97] transition-all duration-200">
                    New Project
                  </button>
                  <button
                    onClick={openFolder}
                    className="h-10 px-5 bg-[#3c3c3c] text-white rounded font-medium hover:bg-[#4c4c4c] active:scale-[0.97] transition-all duration-200"
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
      <div className="h-6 px-3 bg-[#007acc] border-t border-border/30 flex items-center shrink-0">
        <span className="text-xs text-white">
          {rootPath ? `Workspace: ${rootPath}` : "Ready"}
        </span>
      </div>
    </div>
  );
}

export default App;
