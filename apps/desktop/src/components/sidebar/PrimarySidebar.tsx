/**
 * PrimarySidebar - Main collapsible sidebar with tab navigation
 */

import type { FC } from 'react';
import { FileExplorer } from '@/components/file-explorer';
import { SidebarToggle } from './SidebarToggle';
import { TabButton } from './TabButton';
import { TRANSITIONS } from '@/lib/constants';
import { useUIStore, useIsLeftSidebarCollapsed } from '@/stores/uiStore';
import { cn } from '@/lib/utils';

interface PrimarySidebarProps {
  readonly width: number;
  readonly onFileOpen: (path: string) => void;
}

export const PrimarySidebar: FC<PrimarySidebarProps> = ({ width, onFileOpen }) => {
  const isCollapsed = useIsLeftSidebarCollapsed();
  const activeTab = useUIStore((state) => state.activeTab);
  const setActiveTab = useUIStore((state) => state.setActiveTab);

  return (
    <aside
      className="h-full flex flex-col border-r border-border/30 bg-sidebar overflow-hidden"
      style={{
        width,
        transition: `width ${TRANSITIONS.sidebar}`,
      }}
    >
      {/* Header with toggle */}
      <div className="h-10 flex items-center justify-between px-2 shrink-0 border-b border-border/30">
        {!isCollapsed && (
          <span className="text-sm font-medium text-muted-foreground ml-1">Explorer</span>
        )}
        <SidebarToggle className={isCollapsed ? 'mx-auto' : ''} />
      </div>

      {/* Tab Navigation - hidden when collapsed */}
      <div
        className={cn(
          'flex items-center gap-1 px-2 py-1 shrink-0 overflow-hidden transition-all duration-150',
          isCollapsed ? 'h-0 opacity-0' : 'h-10 opacity-100'
        )}
      >
        <TabButton
          label="Explorer"
          active={activeTab === 'explorer'}
          onClick={() => setActiveTab('explorer')}
        />
        <TabButton
          label="Sessions"
          active={activeTab === 'sessions'}
          onClick={() => setActiveTab('sessions')}
        />
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'explorer' && (
          <FileExplorer
            onFileOpen={onFileOpen}
            className={cn(
              'h-full transition-opacity duration-150',
              isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
            )}
          />
        )}
        {activeTab === 'sessions' && (
          <div className={cn(
            'p-3 text-sm text-muted-foreground transition-opacity duration-150',
            isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
          )}>
            Sessions coming soon...
          </div>
        )}
      </div>
    </aside>
  );
};
