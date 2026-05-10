/**
 * Tab - Individual tab component with VS Code-style interactions
 * Supports click to activate, close button, middle-click close, dirty indicator,
 * tab type signatures, repo-colored active indicator, and ghost dimming.
 */

import { useCallback, useMemo, type MouseEvent } from 'react';
import { useDrag, useDrop } from 'react-dnd';
import { motion } from 'motion/react';
import { Cross2Icon, DrawingPinIcon } from '@radix-ui/react-icons';
import { cn } from '@/lib/utils';
import type { PanelInstance, TileId, PanelInstanceId, TabDragItem } from '@/lib/panels/types';
import { DragItemTypes } from '@/lib/panels/types';
import { useIsSessionStreaming } from '@/stores/agentStore';
import { BUILTIN_PANEL_TYPES } from '@/lib/panels/constants';
import { getRepoColorVar, getRepoColorMutedVar } from '@/lib/repoIdentity';
import type { RepoColorName } from '@/lib/repoIdentity';
import { getTabTypeVisuals } from '@/lib/panels/tabTypeVisuals';
import { useIsGhostTab } from '@/hooks/useGhostTabs';
import { useAgentTabState } from '@/hooks/useAgentTabState';

interface TabProps {
  instance: PanelInstance;
  isActive: boolean;
  tileId: TileId;
  index: number;
  tabs: PanelInstance[];
  repoColor?: RepoColorName | null;
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
  repoColor,
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

  // Check if this is a streaming agent tab
  const isAgentTab = instance.panelType === BUILTIN_PANEL_TYPES.AGENT;
  const agentSessionId = isAgentTab
    ? ((instance.data as Record<string, unknown>)?.sessionId as string | undefined) ?? null
    : null;
  const isSessionCurrentlyStreaming = useIsSessionStreaming(agentSessionId);

  // B2: Tab type visual signatures
  const visuals = useMemo(
    () => getTabTypeVisuals(instance, isSessionCurrentlyStreaming),
    [instance, isSessionCurrentlyStreaming],
  );

  // Phase C: Ghost tab detection
  const isGhost = useIsGhostTab(instance.id);
  const ghostActive = isGhost && !isActive;

  // Agent tab attention state. Tabs stay fixed-width; attention is shown as a dot.
  const { needsAttention } = useAgentTabState(agentSessionId);

  return (
    <motion.div
      ref={combinedRef}
      role="tab"
      aria-selected={isActive}
      aria-label={instance.title}
      title={instance.title}
      tabIndex={isActive ? 0 : -1}
      animate={{
        opacity: ghostActive ? 0.5 : isDragging ? 0.5 : 1,
        scale: ghostActive ? 0.97 : 1,
      }}
      transition={{
        default: { type: 'spring', stiffness: 400, damping: 30 },
      }}
      className={cn(
        'group relative flex items-center h-[32px]',
        'transition-[color,background-color,box-shadow] duration-150 ease-out',
        'cursor-pointer select-none',
        'shrink-0 rounded-md overflow-hidden',
        'w-[168px] gap-1.5 px-3',
        isActive
          ? 'bg-foreground/[0.08] text-foreground'
          : 'text-foreground/60 hover:text-foreground/80 hover:bg-foreground/[0.06]',
        isOver && !isDragging && 'bg-foreground/[0.10]',
        needsAttention && !isActive && 'agent-attention-pill',
      )}
      style={{
        backgroundColor: isActive
          ? repoColor
            ? `color-mix(in oklch, ${getRepoColorMutedVar(repoColor)} 50%, transparent)`
            : undefined
          : undefined,
        boxShadow: isActive
          ? repoColor
            ? `inset 0 0 0 1px color-mix(in oklch, ${getRepoColorVar(repoColor)} 25%, transparent), 0 0 8px 0 color-mix(in oklch, ${getRepoColorVar(repoColor)} 12%, transparent)`
            : 'inset 0 0 0 1px oklch(from var(--primary) l c h / 15%), 0 0 8px 0 oklch(from var(--primary) l c h / 12%)'
          : undefined,
      }}
      onClick={onActivate}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
    >
      {/* Fixed-width content. Tabs no longer auto-collapse on hover or inactivity. */}
      <motion.div
        className="flex items-center gap-1.5 flex-1 min-w-0"
        initial={false}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        style={{ pointerEvents: 'auto' }}
      >
        {/* B2: Language dot for file tabs */}
        {visuals.languageDot && (
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: visuals.languageDot }}
          />
        )}

        {/* Attention/streaming indicator takes priority over dirty indicator */}
        {!visuals.languageDot && needsAttention ? (
          <span className="agent-attention-dot w-2 h-2 rounded-full bg-warning shrink-0" />
        ) : !visuals.languageDot && isSessionCurrentlyStreaming ? (
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" />
        ) : !visuals.languageDot && instance.isDirty ? (
          <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
        ) : null}

        {/* Tab title - B2: apply type-specific class */}
        <span className={cn('text-[12px] truncate flex-1', visuals.titleClass)}>
          {instance.title}
        </span>

        {/* Pin icon for pinned tabs, close button for unpinned */}
        {instance.isPinned ? (
          <span
            className="p-0.5 shrink-0 text-muted-foreground"
            title="Pinned - right-click to unpin"
          >
            <DrawingPinIcon className="w-3 h-3" />
          </span>
        ) : (
          <button
            className={cn(
              'p-0.5 rounded-md',
              'opacity-0 group-hover:opacity-100',
              'hover:bg-muted active:scale-95',
              'transition-[transform,opacity] duration-100',
              'shrink-0',
              // Always show close button if dirty
              instance.isDirty && 'opacity-100'
            )}
            onClick={handleCloseClick}
            tabIndex={-1}
            aria-label={`Close ${instance.title}`}
          >
            <Cross2Icon className="w-3.5 h-3.5" />
          </button>
        )}
      </motion.div>

    </motion.div>
  );
}
