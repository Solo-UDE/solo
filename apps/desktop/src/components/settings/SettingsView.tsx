import { useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useUIStore, type SettingsTabId } from '../../stores/uiStore';
import { SettingsSidebar } from './SettingsSidebar';
import { AccountTab } from './tabs/AccountTab';
import { AppearanceTab } from './tabs/AppearanceTab';
import { GeneralTab } from './tabs/GeneralTab';
import { EditorTab } from './tabs/EditorTab';
import { TerminalTab } from './tabs/TerminalTab';
import { FilesTab } from './tabs/FilesTab';
import { ShortcutsTab } from './tabs/ShortcutsTab';
import { AITab } from './tabs/AITab';
import { VoiceTab } from './tabs/VoiceTab';
import { SkillsTab } from './tabs/SkillsTab';
import { PluginsTab } from './tabs/PluginsTab';
import { JourneyPage } from './journey/JourneyPage';
import { LeaderboardPage } from './leaderboard/LeaderboardPage';

const TAB_ORDER: SettingsTabId[] = ['journey', 'leaderboard', 'account', 'general', 'appearance', 'editor', 'terminal', 'files', 'shortcuts', 'ai', 'voice', 'skills', 'plugins'];

const TAB_LABELS: Record<SettingsTabId, string> = {
  journey: 'Your Journey',
  leaderboard: 'Leaderboard',
  account: 'Account',
  general: 'General',
  appearance: 'Appearance',
  editor: 'Editor',
  terminal: 'Terminal',
  files: 'Files',
  shortcuts: 'Shortcuts',
  ai: 'Providers',
  voice: 'Voice',
  skills: 'Skills',
  plugins: 'Plugins',
};

const TAB_DESCRIPTIONS: Record<SettingsTabId, string> = {
  journey: 'Your tier, stats, and progress through Solo.',
  leaderboard: 'Top climbers across Solo, filterable by tier.',
  account: 'See which Solo account is signed in and which GitHub account is connected.',
  general: 'Global desktop behavior and app defaults.',
  appearance: 'Theme, glass, colors, and app typography.',
  editor: 'Code editing preferences and panel ergonomics.',
  terminal: 'Terminal session behavior and shell integration.',
  files: 'Project scanning, file explorer, and workspace file rules.',
  shortcuts: 'Keyboard commands for navigation and chat workflows.',
  ai: 'Providers, model defaults, and agent execution preferences.',
  voice: 'Speech input behavior and audio capture settings.',
  skills: 'Installed skills and assistant capability controls.',
  plugins: 'Plugins bundle skills, MCP servers, and connectors you can enable.',
};

export function SettingsView() {
  const settingsTab = useUIStore((s) => s.settingsTab);
  const setSettingsTab = useUIStore((s) => s.setSettingsTab);
  const closeSettings = useUIStore((s) => s.closeSettings);
  const containerRef = useRef<HTMLDivElement>(null);

  const renderTabContent = () => {
    switch (settingsTab) {
      case 'journey':
        return <JourneyPage />;
      case 'leaderboard':
        return <LeaderboardPage />;
      case 'account':
        return <AccountTab />;
      case 'general':
        return <GeneralTab />;
      case 'appearance':
        return <AppearanceTab />;
      case 'editor':
        return <EditorTab />;
      case 'terminal':
        return <TerminalTab />;
      case 'files':
        return <FilesTab />;
      case 'shortcuts':
        return <ShortcutsTab />;
      case 'ai':
        return <AITab />;
      case 'voice':
        return <VoiceTab />;
      case 'skills':
        return <SkillsTab />;
      case 'plugins':
        return <PluginsTab />;
      default:
        return null;
    }
  };

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSettings();
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        // Only handle arrow keys when focus is not inside an input/textarea
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
          return;
        }
        e.preventDefault();
        const currentIndex = TAB_ORDER.indexOf(settingsTab);
        const direction = e.key === 'ArrowDown' ? 1 : -1;
        const nextIndex = (currentIndex + direction + TAB_ORDER.length) % TAB_ORDER.length;
        setSettingsTab(TAB_ORDER[nextIndex]);
      }
    },
    [settingsTab, setSettingsTab, closeSettings],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Focus container on mount for keyboard nav
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  return (
    <motion.div
      ref={containerRef}
      className="flex h-full w-full gap-2 p-2"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      tabIndex={-1}
    >
      <div className="liquid-sidebar hidden w-[272px] shrink-0 overflow-hidden rounded-[14px] border border-border/70 bg-sidebar/88 backdrop-blur-xl md:block">
        <SettingsSidebar />
      </div>

      <main className="min-w-0 flex-1 overflow-hidden rounded-[14px] border border-border/70 bg-card/90 backdrop-blur-xl">
        <div className="h-full overflow-y-auto">
          <div className="mx-auto max-w-3xl px-7 py-7 lg:px-9 lg:py-8">
            <div className="mb-7">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/65">
                Settings
              </p>
              <h1 className="mt-2 text-[32px] font-semibold tracking-tight text-foreground">
                {TAB_LABELS[settingsTab]}
              </h1>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">
                {TAB_DESCRIPTIONS[settingsTab]}
              </p>
            </div>

            <div className="rounded-[10px] border border-border/60 bg-background/55 p-4 lg:p-5">
              <AnimatePresence mode="wait">
                <motion.div
                  key={settingsTab}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                >
                  {renderTabContent()}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </main>
    </motion.div>
  );
}
