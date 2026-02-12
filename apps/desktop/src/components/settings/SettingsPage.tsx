/**
 * SettingsPage - Full-page settings view with sidebar navigation
 * Covers the entire window including titlebar, with its own drag region
 */

import { useCallback, useRef, useState } from 'react';
import { ArrowLeft, Sun, Code, FolderOpen, Keyboard, Robot, BookOpen, ArrowSquareOut, SignOut } from '@phosphor-icons/react';
import { useUser, useAuthStore } from '../../stores/authStore';
import { GeneralTab } from './tabs/GeneralTab';
import { EditorTab } from './tabs/EditorTab';
import { FilesTab } from './tabs/FilesTab';
import { ShortcutsTab } from './tabs/ShortcutsTab';
import { AITab } from './tabs/AITab';
import { cn } from '../../lib/utils';
import { useTitlebarStyle } from '../../hooks/usePlatform';

interface SettingsPageProps {
  onClose: () => void;
}

type TabId = 'general' | 'editor' | 'files' | 'shortcuts' | 'ai';

interface Tab {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TABS: Tab[] = [
  { id: 'general', label: 'General', icon: Sun },
  { id: 'editor', label: 'Editor', icon: Code },
  { id: 'files', label: 'Files', icon: FolderOpen },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'ai', label: 'AI', icon: Robot },
];

export function SettingsPage({ onClose }: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const firstTabRef = useRef<HTMLButtonElement>(null);
  const user = useUser();
  const signOut = useAuthStore((s) => s.signOut);
  const titlebarStyle = useTitlebarStyle();

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const currentIndex = TABS.findIndex((t) => t.id === activeTab);

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const direction = e.key === 'ArrowDown' ? 1 : -1;
        const nextIndex = (currentIndex + direction + TABS.length) % TABS.length;
        setActiveTab(TABS[nextIndex].id);
      }

      if (e.key === 'Escape') {
        onClose();
      }
    },
    [activeTab, onClose]
  );

  const handleDocsClick = () => {
    window.open('https://docs.solo.dev', '_blank');
  };

  const handleLogout = async () => {
    await signOut();
    onClose();
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'general':
        return <GeneralTab />;
      case 'editor':
        return <EditorTab />;
      case 'files':
        return <FilesTab />;
      case 'shortcuts':
        return <ShortcutsTab />;
      case 'ai':
        return <AITab />;
      default:
        return null;
    }
  };

  return (
    <div className="h-full w-full bg-background flex flex-col" onKeyDown={handleKeyDown}>
      {/* Titlebar / header with drag region */}
      <div
        data-tauri-drag-region
        style={titlebarStyle}
        className="h-[38px] flex items-center shrink-0 bg-background"
      >
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Settings</span>
        </button>
        <div className="flex-1" data-tauri-drag-region />
      </div>

      {/* Body: sidebar + content */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <div className="w-[250px] bg-muted/30 border-r border-border/50 p-4 flex flex-col shrink-0">
          {/* User Info */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-1">
              <div className="text-sm font-semibold text-foreground">
                {(user?.user_metadata?.full_name as string) || user?.email?.split('@')[0] || 'User'}
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {user?.email}
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex-1 space-y-1">
            {TABS.map((tab, index) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  ref={index === 0 ? firstTabRef : undefined}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors text-left cursor-pointer",
                    isActive
                      ? "bg-background text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}

            {/* Docs button */}
            <button
              onClick={handleDocsClick}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer text-muted-foreground hover:text-foreground hover:bg-background/50"
            >
              <BookOpen className="w-4 h-4" />
              <span>Docs</span>
              <ArrowSquareOut className="w-3 h-3 ml-auto opacity-50" />
            </button>
          </nav>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer text-muted-foreground hover:text-foreground hover:bg-background/50 mt-2"
          >
            <SignOut className="w-4 h-4" />
            <span>Log out</span>
          </button>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* Content - scrollable area */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 pt-6 pb-6">
            <div className="max-w-2xl mx-auto">
              <div key={activeTab} className="animate-in fade-in-0 duration-150">
                {renderTabContent()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
