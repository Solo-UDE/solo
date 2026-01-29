/**
 * SettingsModal - Modal dialog with vertical tabbed navigation
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Settings, X, Sun, Code, FolderOpen, Keyboard, Bot } from 'lucide-react';
import { GeneralTab } from './tabs/GeneralTab';
import { EditorTab } from './tabs/EditorTab';
import { FilesTab } from './tabs/FilesTab';
import { ShortcutsTab } from './tabs/ShortcutsTab';
import { AITab } from './tabs/AITab';

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
  { id: 'ai', label: 'AI', icon: Bot },
];

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const modalRef = useRef<HTMLDivElement>(null);
  const firstTabRef = useRef<HTMLButtonElement>(null);

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
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      // Tab navigation with arrow keys
      const currentIndex = TABS.findIndex((t) => t.id === activeTab);

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const direction = e.key === 'ArrowDown' ? 1 : -1;
        const nextIndex = (currentIndex + direction + TABS.length) % TABS.length;
        setActiveTab(TABS[nextIndex].id);
      }
    },
    [activeTab, onClose]
  );

  if (!isOpen) return null;

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={modalRef}
        className="bg-bg-surface-1 border border-border-subtle rounded-xl shadow-2xl w-[680px] h-[520px] flex flex-col overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle shrink-0">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-medium text-foreground">Settings</h2>
            <span className="text-xs text-muted-foreground font-mono">⌘,</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-bg-surface-2 transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 flex min-h-0">
          {/* Sidebar tabs */}
          <nav className="w-40 border-r border-border-subtle bg-bg-surface-2/50 py-2 shrink-0">
            {TABS.map((tab, index) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  ref={index === 0 ? firstTabRef : undefined}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    w-full flex items-center gap-2 px-4 py-2 text-sm
                    transition-all duration-150 text-left
                    ${isActive
                      ? 'bg-primary/10 text-primary border-r-2 border-primary'
                      : 'text-muted-foreground hover:bg-bg-surface-3 hover:text-foreground'
                    }
                  `}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 bg-bg-base">
            {renderTabContent()}
          </div>
        </div>
      </div>
    </div>
  );
}
