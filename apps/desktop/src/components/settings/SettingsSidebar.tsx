import { useState } from 'react';
import { Sun, Code, Terminal, FolderOpen, Keyboard, Robot, BookOpen, ArrowSquareOut, SignOut, ArrowLeft, ArrowCounterClockwise } from '@phosphor-icons/react';
import { useUIStore, type SettingsTabId } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { cn } from '../../lib/utils';

interface TabDef {
  id: SettingsTabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TABS: TabDef[] = [
  { id: 'general', label: 'General', icon: Sun },
  { id: 'editor', label: 'Editor', icon: Code },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'files', label: 'Files', icon: FolderOpen },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'ai', label: 'AI', icon: Robot },
];

export function SettingsSidebar() {
  const settingsTab = useUIStore((s) => s.settingsTab);
  const setSettingsTab = useUIStore((s) => s.setSettingsTab);
  const closeSettings = useUIStore((s) => s.closeSettings);
  const signOut = useAuthStore((s) => s.signOut);

  const handleLogout = async () => {
    await signOut();
    closeSettings();
  };

  return (
    <div className="w-52 border-r border-white/[0.06] bg-sidebar p-4 flex flex-col shrink-0">
      {/* Back button */}
      <button
        onClick={closeSettings}
        className="flex items-center gap-2 px-2 py-1.5 mb-4 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer rounded hover:bg-background/50"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>Back to app</span>
        <kbd className="ml-auto text-[10px] text-muted-foreground/60 bg-muted/50 px-1.5 py-0.5 rounded">Esc</kbd>
      </button>

      {/* Navigation */}
      <nav className="flex-1 space-y-0.5">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = settingsTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSettingsTab(tab.id)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left cursor-pointer rounded',
                isActive
                  ? 'bg-background text-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/50',
              )}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="space-y-0.5 pt-2 border-t border-border/30">
        <button
          onClick={() => window.open('https://docs.solo.dev', '_blank')}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-muted-foreground hover:text-foreground hover:bg-background/50 rounded"
        >
          <BookOpen className="w-4 h-4" />
          <span>Docs</span>
          <ArrowSquareOut className="w-3 h-3 ml-auto opacity-50" />
        </button>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-muted-foreground hover:text-foreground hover:bg-background/50 rounded"
        >
          <SignOut className="w-4 h-4" />
          <span>Log out</span>
        </button>
      </div>
    </div>
  );
}
