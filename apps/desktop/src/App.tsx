import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

function App() {
  const [backendStatus, setBackendStatus] = useState<string>("Connecting...");

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

  return (
    <div className="h-screen w-screen bg-background text-foreground flex flex-col">
      {/* Titlebar drag region */}
      <div
        data-tauri-drag-region
        className="h-12 flex items-center px-4 bg-card/80 backdrop-blur-sm border-b border-border/30"
      >
        <div className="flex-1" data-tauri-drag-region>
          <span className="text-sm font-medium text-muted-foreground">Solo</span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-6">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight">Solo IDE</h1>
            <p className="text-muted-foreground">AI-native development environment</p>
          </div>

          <div className="inline-flex items-center gap-2 px-4 py-2 bg-card rounded-xl shadow-lg">
            <div className={`w-2 h-2 rounded-full ${
              backendStatus.includes("connected")
                ? "bg-green-500"
                : backendStatus.includes("error")
                  ? "bg-red-500"
                  : "bg-yellow-500 animate-pulse"
            }`} />
            <span className="text-sm text-muted-foreground">{backendStatus}</span>
          </div>

          <div className="pt-8 flex gap-3 justify-center">
            <button className="h-10 px-5 bg-primary text-primary-foreground rounded-xl font-medium hover:brightness-110 active:scale-[0.97] transition-all duration-200">
              New Project
            </button>
            <button className="h-10 px-5 bg-muted/60 text-foreground rounded-xl font-medium hover:bg-muted active:scale-[0.97] transition-all duration-200">
              Open Folder
            </button>
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div className="h-6 px-3 bg-card/60 border-t border-border/30 flex items-center">
        <span className="text-xs text-muted-foreground">Ready</span>
      </div>
    </div>
  );
}

export default App;
