import { useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useUIStore, type SettingsTabId } from '../../stores/uiStore';
import { SettingsSidebar } from './SettingsSidebar';
import { GeneralTab } from './tabs/GeneralTab';
import { EditorTab } from './tabs/EditorTab';
import { TerminalTab } from './tabs/TerminalTab';
import { FilesTab } from './tabs/FilesTab';
import { ShortcutsTab } from './tabs/ShortcutsTab';
import { AITab } from './tabs/AITab';
import { VoiceTab } from './tabs/VoiceTab';
import { SkillsTab } from './tabs/SkillsTab';

const TAB_ORDER: SettingsTabId[] = ['general', 'editor', 'terminal', 'files', 'shortcuts', 'ai', 'voice', 'skills'];

const TAB_LABELS: Record<SettingsTabId, string> = {
  general: 'General',
  editor: 'Editor',
  terminal: 'Terminal',
  files: 'Files',
  shortcuts: 'Shortcuts',
  ai: 'Providers',
  voice: 'Voice',
  skills: 'Skills',
};

export function SettingsView() {
  const settingsTab = useUIStore((s) => s.settingsTab);
  const setSettingsTab = useUIStore((s) => s.setSettingsTab);
  const closeSettings = useUIStore((s) => s.closeSettings);
  const containerRef = useRef<HTMLDivElement>(null);

  const renderTabContent = () => {
    switch (settingsTab) {
      case 'general':
        return <GeneralTab />;
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
      className="flex h-full w-full"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      tabIndex={-1}
    >
      <SettingsSidebar />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="max-w-2xl mx-auto px-8 py-8">
          <h1 className="text-2xl font-semibold mb-6">{TAB_LABELS[settingsTab]}</h1>
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
      </main>
    </motion.div>
  );
}
