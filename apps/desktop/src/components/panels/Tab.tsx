/**
 * Tab - Individual tab component with VS Code-style interactions
 * Supports click to activate, close button, middle-click close, dirty indicator
 */

import { useCallback, type MouseEvent } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import { X, Pin } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PanelInstance, TileId, PanelInstanceId, TabDragItem } from '@/lib/panels/types';
import { DragItemTypes } from '@/lib/panels/types';

interface TabProps {
  instance: PanelInstance;
  isActive: boolean;
  tileId: TileId;
  index: number;
  tabs: PanelInstance[];
  onActivate: () => void;
  onClose: () => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onMoveToTile: (instanceId: PanelInstanceId, fromTileId: TileId, toTileId: TileId) => void;
  onContextMenu: (e: MouseEvent, instanceId: PanelInstanceId) => void;
}

export function Tab({
  instance,
  isActive,
  tileId,
  index,
  tabs,
  onActivate,
  onClose,
  onReorder,
  onMoveToTile,
  onContextMenu,
}: TabProps) {
  // Drag source configuration - use function form with dependencies
  const [{ isDragging }, drag] = useDrag<TabDragItem, unknown, { isDragging: boolean }>(
    () => ({
      type: DragItemTypes.TAB,
      item: {
        type: DragItemTypes.TAB,
        instanceId: instance.id,
        sourceTileId: tileId,
        panelType: instance.panelType,
      },
      collect: (monitor) => ({
        isDragging: monitor.isDragging(),
      }),
    }),
    [instance.id, instance.panelType, tileId]
  );

  // Drop target configuration for reordering - use function form with dependencies
  const [{ isOver }, drop] = useDrop<TabDragItem, unknown, { isOver: boolean }>(
    () => ({
      accept: DragItemTypes.TAB,
      hover: (item, monitor) => {
        if (!monitor.isOver({ shallow: true })) return;

        // If from the same tile, handle reordering
        if (item.sourceTileId === tileId) {
          const dragIndex = tabs.findIndex(tab => tab.id === item.instanceId);
          if (dragIndex !== -1 && dragIndex !== index) {
            onReorder(dragIndex, index);
          }
        }
      },
      drop: (item) => {
        // If from a different tile, move the tab
        if (item.sourceTileId !== tileId) {
          onMoveToTile(item.instanceId, item.sourceTileId, tileId);
        }
      },
      collect: (monitor) => ({
        isOver: monitor.isOver({ shallow: true }),
      }),
    }),
    [tileId, tabs, index, onReorder, onMoveToTile]
  );

  // Handle middle-click to close (not for pinned tabs)
  const handleMouseDown = useCallback(
    (e: MouseEvent) => {
      if (e.button === 1 && !instance.isPinned) {
        // Middle mouse button - only close if not pinned
        e.preventDefault();
        onClose();
      }
    },
    [instance.isPinned, onClose]
  );

  // Handle close button click
  const handleCloseClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      onClose();
    },
    [onClose]
  );

  // Handle right-click context menu
  const handleContextMenu = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu(e, instance.id);
    },
    [instance.id, onContextMenu]
  );

  // Combine drag and drop refs
  const combinedRef = (node: HTMLDivElement | null) => {
    drag(node);
    drop(node);
  };

  return (
    <div
      ref={combinedRef}
      role="tab"
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      className={cn(
        'group relative flex items-center gap-1.5 h-[35px] px-3',
        'border-r border-border/20',
        'transition-all duration-150 ease-out',
        'cursor-pointer select-none',
        'shrink-0 min-w-[80px] max-w-[200px]',
        isActive
          ? 'bg-card text-foreground'
          : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40',
        isDragging && 'opacity-50',
        isOver && !isDragging && 'bg-primary/10'
      )}
      onClick={onActivate}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
    >
      {/* Dirty indicator */}
      {instance.isDirty && (
        <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
      )}

      {/* Tab title */}
      <span className="text-sm truncate flex-1">{instance.title}</span>

      {/* Pin icon for pinned tabs, close button for unpinned */}
      {instance.isPinned ? (
        <span
          className="p-0.5 shrink-0 text-muted-foreground"
          title="Pinned - right-click to unpin"
        >
          <Pin className="w-3 h-3" />
        </span>
      ) : (
        <button
          className={cn(
            'p-0.5 rounded-sm',
            'opacity-0 group-hover:opacity-100',
            'hover:bg-muted active:scale-95',
            'transition-all duration-100',
            'shrink-0',
            // Always show close button if dirty
            instance.isDirty && 'opacity-100'
          )}
          onClick={handleCloseClick}
          tabIndex={-1}
          aria-label={`Close ${instance.title}`}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Active tab indicator line */}
      {isActive && (
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary" />
      )}
    </div>
  );
}
