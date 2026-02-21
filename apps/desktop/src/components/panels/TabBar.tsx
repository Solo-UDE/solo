/**
 * TabBar - Container for tabs in a tile
 * Handles tab overflow with horizontal scrolling
 */

import { useCallback, useRef, useState, useEffect, type MouseEvent } from 'react';
import { useDrop } from 'react-dnd';
import { LayoutGroup, motion } from 'motion/react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { Tab } from './Tab';
import type { PanelInstance, TileId, PanelInstanceId, TabDragItem } from '@/lib/panels/types';
import { DragItemTypes } from '@/lib/panels/types';
import { TAB_BAR } from '@/lib/panels/constants';

interface TabBarProps {
  tileId: TileId;
  tabs: PanelInstance[];
  activeTabId: PanelInstanceId | null;
  onTabActivate: (instanceId: PanelInstanceId) => void;
  onTabClose: (instanceId: PanelInstanceId) => void;
  onTabReorder: (fromIndex: number, toIndex: number) => void;
  onTabDrop: (instanceId: PanelInstanceId, fromTileId: TileId) => void;
  onTabContextMenu: (e: MouseEvent, instanceId: PanelInstanceId) => void;
}

export function TabBar({
  tileId,
  tabs,
  activeTabId,
  onTabActivate,
  onTabClose,
  onTabReorder,
  onTabDrop,
  onTabContextMenu,
}: TabBarProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Check scroll state
  const updateScrollState = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    setCanScrollLeft(container.scrollLeft > 0);
    setCanScrollRight(
      container.scrollLeft < container.scrollWidth - container.clientWidth - 1
    );
  }, []);

  // Update scroll state on resize and tab changes
  useEffect(() => {
    updateScrollState();
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener('scroll', updateScrollState);
      window.addEventListener('resize', updateScrollState);
      return () => {
        container.removeEventListener('scroll', updateScrollState);
        window.removeEventListener('resize', updateScrollState);
      };
    }
  }, [updateScrollState, tabs.length]);

  // Scroll handlers
  const scrollLeft = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollBy({ left: -150, behavior: 'smooth' });
    }
  }, []);

  const scrollRight = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.scrollBy({ left: 150, behavior: 'smooth' });
    }
  }, []);

  // Drop target for the tab bar (for dropping tabs from other tiles)
  const [{ isOver }, drop] = useDrop<TabDragItem, unknown, { isOver: boolean }>(
    () => ({
      accept: DragItemTypes.TAB,
      drop: (item) => {
        if (item.sourceTileId !== tileId) {
          onTabDrop(item.instanceId, item.sourceTileId);
        }
      },
      collect: (monitor) => ({
        isOver: monitor.isOver({ shallow: true }) && monitor.canDrop(),
      }),
    }),
    [tileId, onTabDrop]
  );

  // Handle tab move from another tile
  const handleMoveToTile = useCallback(
    (instanceId: PanelInstanceId, fromTileId: TileId, toTileId: TileId) => {
      if (fromTileId !== toTileId) {
        onTabDrop(instanceId, fromTileId);
      }
    },
    [onTabDrop]
  );

  // Combine drop ref with our container
  const dropRef = useCallback(
    (node: HTMLDivElement | null) => {
      drop(node);
    },
    [drop]
  );

  if (tabs.length === 0) {
    return null;
  }

  return (
    <div
      ref={dropRef}
      className={cn(
        'flex items-center bg-muted/30 border-b border-border/30',
        'h-[35px] min-h-[35px] transition-colors duration-150',
        isOver && 'bg-primary/10'
      )}
      style={{ height: TAB_BAR.height }}
    >
      {/* Scroll left button */}
      {canScrollLeft && (
        <button
          className={cn(
            'flex items-center justify-center w-6 h-full',
            'bg-muted/50 hover:bg-muted border-r border-border/30',
            'transition-colors duration-100'
          )}
          onClick={scrollLeft}
          aria-label="Scroll tabs left"
        >
          <CaretLeft className="w-4 h-4 text-muted-foreground" />
        </button>
      )}

      {/* Tabs container with horizontal scroll */}
      <div
        ref={scrollContainerRef}
        className="flex-1 flex items-center overflow-x-auto scrollbar-none"
        role="tablist"
      >
        <LayoutGroup>
          {tabs.map((tab, index) => (
            <motion.div key={tab.id} layout transition={{ type: 'spring', stiffness: 500, damping: 35 }}>
              <Tab
                instance={tab}
                isActive={tab.id === activeTabId}
                tileId={tileId}
                index={index}
                tabs={tabs}
                onActivate={() => onTabActivate(tab.id)}
                onClose={() => onTabClose(tab.id)}
                onReorder={onTabReorder}
                onMoveToTile={handleMoveToTile}
                onContextMenu={onTabContextMenu}
              />
            </motion.div>
          ))}
        </LayoutGroup>
      </div>

      {/* Scroll right button */}
      {canScrollRight && (
        <button
          className={cn(
            'flex items-center justify-center w-6 h-full',
            'bg-muted/50 hover:bg-muted border-l border-border/30',
            'transition-colors duration-100'
          )}
          onClick={scrollRight}
          aria-label="Scroll tabs right"
        >
          <CaretRight className="w-4 h-4 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}
