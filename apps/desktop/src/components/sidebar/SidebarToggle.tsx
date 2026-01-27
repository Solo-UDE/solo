/**
 * SidebarToggle - Button to collapse/expand the left sidebar
 */

import { PanelLeft, PanelLeftClose } from 'lucide-react';
import type { FC } from 'react';
import { useUIStore, useIsLeftSidebarCollapsed } from '@/stores/uiStore';

export interface SidebarToggleProps {
  className?: string;
}

export const SidebarToggle: FC<SidebarToggleProps> = ({ className }) => {
  const isCollapsed = useIsLeftSidebarCollapsed();
  const toggleSidebar = useUIStore((state) => state.toggleLeftSidebar);

  return (
    <button
      onClick={toggleSidebar}
      className={`h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted/60 hover:scale-105 active:scale-95 transition-all duration-150 text-muted-foreground hover:text-foreground ${className ?? ''}`}
      title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
      aria-label={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
    >
      {isCollapsed ? (
        <PanelLeft className="h-4 w-4" />
      ) : (
        <PanelLeftClose className="h-4 w-4" />
      )}
    </button>
  );
};
