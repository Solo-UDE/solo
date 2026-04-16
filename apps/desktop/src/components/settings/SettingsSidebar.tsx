import { useState } from 'react';
import { SunIcon, CodeIcon, ArrowLeftIcon, ExitIcon, ExternalLinkIcon, ReaderIcon, CounterClockwiseClockIcon } from '@radix-ui/react-icons';
import { Terminal, FolderOpen, Keyboard, Brain, Mic, Zap } from 'lucide-react';
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
  { id: 'general', label: 'General', icon: SunIcon },
  { id: 'editor', label: 'Editor', icon: CodeIcon },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'files', label: 'Files', icon: FolderOpen },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'ai', label: 'Providers', icon: Brain },
  { id: 'voice', label: 'Voice', icon: Mic },
  { id: 'skills', label: 'Skills', icon: Zap },
];

export function SettingsSidebar() {
  const settingsTab = useUIStore((s) => s.settingsTab);
  const setSettingsTab = useUIStore((s) => s.setSettingsTab);
  const closeSettings = useUIStore((s) => s.closeSettings);
  const signOut = useAuthStore((s) => s.signOut);
  const resetToDefaults = useSettingsStore((s) => s.resetToDefaults);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const handleLogout = async () => {
    await signOut();
    closeSettings();
  };

  const handleResetAll = () => {
    resetToDefaults();
    setShowResetConfirm(false);
  };

  return (
    <div className="w-52 border-r border-white/[0.06] bg-sidebar p-4 flex flex-col shrink-0">
      {/* Back button */}
      <button
        onClick={closeSettings}
        className="flex items-center gap-2 px-2 py-1.5 mb-4 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer rounded hover:bg-background/50"
      >
        <ArrowLeftIcon className="w-3.5 h-3.5" />
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
          <ReaderIcon className="w-4 h-4" />
          <span>Docs</span>
          <ExternalLinkIcon className="w-3 h-3 ml-auto opacity-50" />
        </button>
        {showResetConfirm ? (
          <div className="px-3 py-2 space-y-2">
            <p className="text-xs text-muted-foreground">Reset all settings to defaults?</p>
            <div className="flex gap-2">
              <button
                onClick={handleResetAll}
                className="flex-1 px-2 py-1 text-xs bg-destructive/10 text-destructive hover:bg-destructive/20 rounded transition-colors"
              >
                Reset
              </button>
              <button
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 px-2 py-1 text-xs text-muted-foreground hover:bg-background/50 rounded transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowResetConfirm(true)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-muted-foreground hover:text-foreground hover:bg-background/50 rounded"
          >
            <CounterClockwiseClockIcon className="w-4 h-4" />
            <span>Reset All Settings</span>
          </button>
        )}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors cursor-pointer text-muted-foreground hover:text-foreground hover:bg-background/50 rounded"
        >
          <ExitIcon className="w-4 h-4" />
          <span>Log out</span>
        </button>
      </div>

      {/* Version */}
      <div className="pt-2 text-[10px] text-muted-foreground/50 text-center">
        Solo IDE v0.1.0
      </div>
    </div>
  );
}
