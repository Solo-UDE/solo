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
        <div className="space-y-2" style={{ animation: 'slide-up 250ms var(--ease-smooth) both' }}>
          <h1 className="text-4xl font-bold tracking-tight">Solo IDE</h1>
          <p className="text-muted-foreground">AI-native development environment</p>
        </div>

        {rootPath ? (
          <div className="pt-4" style={{ animation: 'slide-up 250ms var(--ease-smooth) 80ms both' }}>
            <p className="text-sm text-muted-foreground">
              Open a file from the explorer to start editing
            </p>
          </div>
        ) : (
          <div className="pt-8 flex gap-3 justify-center" style={{ animation: 'slide-up 250ms var(--ease-smooth) 160ms both' }}>
            <button className="h-10 px-5 bg-primary text-primary-foreground rounded-xl font-medium hover:brightness-110 active:scale-[0.97] transition-[transform,background-color] duration-200">
              New Project
            </button>
            <button
              onClick={openFolder}
              className="h-10 px-5 bg-muted/60 text-foreground rounded-xl font-medium hover:bg-muted active:scale-[0.97] transition-[transform,background-color] duration-200"
            >
              Open Folder
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
