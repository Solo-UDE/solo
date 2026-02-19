/**
 * SidebarToggle - Button to collapse/expand the left sidebar
 */

import { SidebarSimple } from '@phosphor-icons/react';
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
      className={`h-8 w-8 flex items-center justify-center rounded-lg hover:bg-muted/60 hover:scale-105 active:scale-95 transition-[transform,background-color,color] duration-150 text-muted-foreground hover:text-foreground relative ${className ?? ''}`}
      title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
      aria-label={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
    >
      <SidebarSimple
        weight="regular"
        className={`h-4 w-4 absolute transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          isCollapsed ? 'opacity-100 scale-100' : 'opacity-0 scale-90'
        }`}
      />
      <SidebarSimple
        weight="fill"
        className={`h-4 w-4 absolute transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          isCollapsed ? 'opacity-0 scale-90' : 'opacity-100 scale-100'
        }`}
      />
    </button>
  );
};
