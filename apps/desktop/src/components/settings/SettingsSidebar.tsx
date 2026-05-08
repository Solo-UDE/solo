import { useState } from 'react';
import { SunIcon, CodeIcon, ArrowLeftIcon, ExitIcon, ExternalLinkIcon, ReaderIcon, CounterClockwiseClockIcon, StarIcon, RocketIcon } from '@radix-ui/react-icons';
import { Terminal, FolderOpen, Keyboard, Brain, Mic, UserRound, Zap, Puzzle, Palette } from 'lucide-react';
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
  { id: 'journey', label: 'Your Journey', icon: RocketIcon },
  { id: 'leaderboard', label: 'Leaderboard', icon: StarIcon },
  { id: 'account', label: 'Account', icon: UserRound },
  { id: 'general', label: 'General', icon: SunIcon },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'editor', label: 'Editor', icon: CodeIcon },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'files', label: 'Files', icon: FolderOpen },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'ai', label: 'Providers', icon: Brain },
  { id: 'voice', label: 'Voice', icon: Mic },
  { id: 'skills', label: 'Skills', icon: Zap },
  { id: 'plugins', label: 'Plugins', icon: Puzzle },
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
    <div className="flex h-full flex-col p-4">
      <div className="mb-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/65">
          Preferences
        </p>
        <p className="mt-1 text-sm font-medium text-foreground">Desktop settings</p>
      </div>

      <button
        onClick={closeSettings}
        className="mb-4 flex items-center gap-2 rounded-[8px] border border-border/60 bg-background/65 px-3 py-2 text-sm text-muted-foreground transition-[background-color,color,border-color] cursor-pointer hover:bg-card hover:text-foreground"
      >
        <ArrowLeftIcon className="w-3.5 h-3.5" />
        <span>Back to app</span>
        <kbd className="ml-auto rounded-[6px] bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground/60">Esc</kbd>
      </button>

      <nav className="flex-1 space-y-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = settingsTab === tab.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSettingsTab(tab.id)}
              data-sidebar-active={isActive}
              data-sidebar-hover
              className={cn(
                'w-full flex items-center gap-3 rounded-[8px] px-3 py-2 text-sm transition-colors text-left cursor-pointer',
                isActive
                  ? 'border border-border/70 bg-card text-foreground'
                  : 'border border-transparent text-muted-foreground hover:border-border/50 hover:bg-background/60 hover:text-foreground',
              )}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="space-y-1 border-t border-border/60 pt-4">
        <button
          onClick={() => window.open('https://docs.solo.dev', '_blank')}
          className="w-full flex items-center gap-2 rounded-[8px] px-3 py-2 text-sm transition-colors cursor-pointer text-muted-foreground hover:bg-background/60 hover:text-foreground"
        >
          <ReaderIcon className="w-4 h-4" />
          <span>Docs</span>
          <ExternalLinkIcon className="w-3 h-3 ml-auto opacity-50" />
        </button>
        {showResetConfirm ? (
          <div className="space-y-2 rounded-[10px] border border-border/60 bg-background/55 px-3 py-3">
            <p className="text-xs text-muted-foreground">Reset all settings to defaults?</p>
            <div className="flex gap-2">
              <button
                onClick={handleResetAll}
                className="flex-1 rounded-[8px] bg-destructive/10 px-2 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/20"
              >
                Reset
              </button>
              <button
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 rounded-[8px] px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-background"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowResetConfirm(true)}
            className="w-full flex items-center gap-2 rounded-[8px] px-3 py-2 text-sm transition-colors cursor-pointer text-muted-foreground hover:bg-background/60 hover:text-foreground"
          >
            <CounterClockwiseClockIcon className="w-4 h-4" />
            <span>Reset All Settings</span>
          </button>
        )}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2 rounded-[8px] px-3 py-2 text-sm transition-colors cursor-pointer text-muted-foreground hover:bg-background/60 hover:text-foreground"
        >
          <ExitIcon className="w-4 h-4" />
          <span>Log out</span>
        </button>
      </div>

      <div className="pt-4 text-center text-[10px] text-muted-foreground/50">
        Solo IDE v0.1.0
      </div>
    </div>
  );
}
