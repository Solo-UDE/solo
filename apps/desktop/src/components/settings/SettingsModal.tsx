/**
 * SettingsModal - Modal dialog with vertical tabbed navigation
 * Redesigned with Radix UI Dialog and Orchids-inspired styling
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { GearSix, X, Sun, Code, FolderOpen, Keyboard, Robot, BookOpen, ArrowSquareOut, SignOut } from '@phosphor-icons/react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '../ui/dialog';
import { useUser, useAuthStore } from '../../stores/authStore';
import { GeneralTab } from './tabs/GeneralTab';
import { EditorTab } from './tabs/EditorTab';
import { FilesTab } from './tabs/FilesTab';
import { ShortcutsTab } from './tabs/ShortcutsTab';
import { AITab } from './tabs/AITab';
import { cn } from '../../lib/utils';

interface SettingsModalProps {
  isOpen: boolean;
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

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const firstTabRef = useRef<HTMLButtonElement>(null);
  const user = useUser();
  const signOut = useAuthStore((s) => s.signOut);

  // Focus management
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        firstTabRef.current?.focus();
      }, 50);
    } else {
      setActiveTab('general');
    }
  }, [isOpen]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Tab navigation with arrow keys
      const currentIndex = TABS.findIndex((t) => t.id === activeTab);

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const direction = e.key === 'ArrowDown' ? 1 : -1;
        const nextIndex = (currentIndex + direction + TABS.length) % TABS.length;
        setActiveTab(TABS[nextIndex].id);
      }
    },
    [activeTab]
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
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-[900px] w-[900px] max-w-[90vw] h-[600px] p-0 overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        {/* Hidden title for accessibility */}
        <DialogTitle className="sr-only">Settings</DialogTitle>

        <div className="flex h-full">
          {/* Sidebar */}
          <div className="w-64 bg-muted/30 border-r border-border p-4 flex flex-col shrink-0">
            {/* User Info Section */}
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
                      "w-full flex items-center gap-2 px-3 py-2 rounded-none text-sm transition-colors text-left cursor-pointer",
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
                className="w-full flex items-center gap-2 px-3 py-2 rounded-none text-sm transition-colors cursor-pointer text-muted-foreground hover:text-foreground hover:bg-background/50"
              >
                <BookOpen className="w-4 h-4" />
                <span>Docs</span>
                <ArrowSquareOut className="w-3 h-3 ml-auto opacity-50" />
              </button>
            </nav>

            {/* Logout button at bottom */}
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-none text-sm transition-colors cursor-pointer text-muted-foreground hover:text-foreground hover:bg-background/50 mt-2"
            >
              <SignOut className="w-4 h-4" />
              <span>Log out</span>
            </button>
          </div>

          {/* Main Content */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <GearSix className="w-4 h-4 text-muted-foreground" />
                <h2 className="text-sm font-medium text-foreground">
                  {TABS.find((t) => t.id === activeTab)?.label}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1 rounded-none hover:bg-muted transition-colors"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            {/* Content - scrollable area */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 pt-4 pb-6">
              <div key={activeTab} className="animate-in fade-in-0 duration-150">
                {renderTabContent()}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
