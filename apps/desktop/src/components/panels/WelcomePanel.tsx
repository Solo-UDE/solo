/**
 * WelcomePanel - Welcome screen panel
 * Shows when no files are open
 */

import { useFileExplorerStore } from '@/stores/fileExplorerStore';
import type { PanelProps } from '@/lib/panels/types';

export function WelcomePanel(_props: PanelProps) {
  const openFolder = useFileExplorerStore((s) => s.openFolder);
  const rootPath = useFileExplorerStore((s) => s.rootPath);

  return (
    <div className="h-full flex items-center justify-center bg-background">
      <div className="text-center space-y-6">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">Solo IDE</h1>
          <p className="text-muted-foreground">AI-native development environment</p>
        </div>

        {rootPath ? (
          <div className="pt-4">
            <p className="text-sm text-muted-foreground">
              Open a file from the explorer to start editing
            </p>
          </div>
        ) : (
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
        )}
      </div>
    </div>
  );
}
