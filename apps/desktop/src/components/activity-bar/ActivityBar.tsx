/**
 * ActivityBar - VS Code-style vertical icon bar on the left edge
 * Provides quick access to main views and features
 */

import { useCallback } from 'react';
import {
  Files,
  MessageSquare,
  GitBranch,
  Settings,
  Search,
} from 'lucide-react';
import { ActivityBarItem } from './ActivityBarItem';
import { useUIStore } from '@/stores/uiStore';
import { cn } from '@/lib/utils';

interface ActivityBarProps {
  onSettingsClick: () => void;
  className?: string;
}

export function ActivityBar({ onSettingsClick, className }: ActivityBarProps) {
  const activeTab = useUIStore((state) => state.activeTab);
  const setActiveTab = useUIStore((state) => state.setActiveTab);
  const leftSidebarWidth = useUIStore((state) => state.leftSidebarWidth);
  const setLeftSidebarWidth = useUIStore((state) => state.setLeftSidebarWidth);

  const COLLAPSED_WIDTH = 0;
  const EXPANDED_WIDTH = 256;

  const isExplorerActive = activeTab === 'explorer';
  const isSessionsActive = activeTab === 'sessions';
  const isSidebarCollapsed = leftSidebarWidth <= 40;

  // Toggle sidebar and switch to explorer tab
  const handleExplorerClick = useCallback(() => {
    if (isExplorerActive && !isSidebarCollapsed) {
      // Already on explorer and sidebar is open - collapse it
      setLeftSidebarWidth(COLLAPSED_WIDTH);
    } else {
      // Switch to explorer and expand sidebar
      setActiveTab('explorer');
      if (isSidebarCollapsed) {
        setLeftSidebarWidth(EXPANDED_WIDTH);
      }
    }
  }, [isExplorerActive, isSidebarCollapsed, setActiveTab, setLeftSidebarWidth]);

  // Toggle sidebar and switch to sessions tab
  const handleSessionsClick = useCallback(() => {
    if (isSessionsActive && !isSidebarCollapsed) {
      // Already on sessions and sidebar is open - collapse it
      setLeftSidebarWidth(COLLAPSED_WIDTH);
    } else {
      // Switch to sessions and expand sidebar
      setActiveTab('sessions');
      if (isSidebarCollapsed) {
        setLeftSidebarWidth(EXPANDED_WIDTH);
      }
    }
  }, [isSessionsActive, isSidebarCollapsed, setActiveTab, setLeftSidebarWidth]);

  // Search placeholder (future feature)
  const handleSearchClick = useCallback(() => {
    // TODO: Open command palette with search mode
    console.log('Search clicked - will open Cmd+Shift+F panel');
  }, []);

  // Source control placeholder (future feature)
  const handleGitClick = useCallback(() => {
    // TODO: Open source control panel
    console.log('Git clicked - will open source control panel');
  }, []);

  return (
    <aside
      className={cn(
        'flex flex-col items-center',
        'w-12 h-full shrink-0',
        'bg-activity-bar border-r border-border-subtle',
        className
      )}
    >
      {/* Top section - main navigation */}
      <div className="flex-1 flex flex-col items-center pt-1">
        <ActivityBarItem
          icon={<Files className="w-5 h-5" />}
          label="Explorer"
          shortcut="⌘B"
          isActive={isExplorerActive && !isSidebarCollapsed}
          onClick={handleExplorerClick}
        />

        <ActivityBarItem
          icon={<MessageSquare className="w-5 h-5" />}
          label="Sessions"
          shortcut="⌘J"
          isActive={isSessionsActive && !isSidebarCollapsed}
          onClick={handleSessionsClick}
        />

        <ActivityBarItem
          icon={<Search className="w-5 h-5" />}
          label="Search"
          shortcut="⌘⇧F"
          onClick={handleSearchClick}
        />

        <ActivityBarItem
          icon={<GitBranch className="w-5 h-5" />}
          label="Source Control"
          shortcut="⌃⇧G"
          onClick={handleGitClick}
        />
      </div>

      {/* Bottom section - settings */}
      <div className="flex flex-col items-center pb-2">
        <ActivityBarItem
          icon={<Settings className="w-5 h-5" />}
          label="Settings"
          shortcut="⌘,"
          position="bottom"
          onClick={onSettingsClick}
        />
      </div>
    </aside>
  );
}
