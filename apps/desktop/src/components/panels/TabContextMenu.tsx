/**
 * TabContextMenu - Right-click context menu for panel tabs
 * Actions: Close, Close Others, Close All, Pin/Unpin
 */

import { useCallback, useEffect, useRef } from 'react';
import { X, XCircle, PushPin, PushPinSlash } from '@phosphor-icons/react';
import type { PanelInstanceId, TileId } from '@/lib/panels/types';

interface ContextMenuPosition {
  x: number;
  y: number;
}

interface TabContextMenuProps {
  position: ContextMenuPosition | null;
  instanceId: PanelInstanceId | null;
  tileId: TileId;
  isPinned: boolean;
  tabCount: number;
  onClose: () => void;
  onCloseTab: () => void;
  onCloseOthers: () => void;
  onCloseAll: () => void;
  onTogglePin: () => void;
}

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
}

function MenuItem({ icon, label, shortcut, onClick, disabled }: MenuItemProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm
        cursor-pointer transition-colors
        ${disabled
          ? 'text-muted-foreground/50 cursor-not-allowed'
          : 'text-foreground hover:bg-accent'}
      `}
    >
      <span className="w-4 h-4 flex items-center justify-center">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {shortcut && (
        <span className="text-xs text-muted-foreground">{shortcut}</span>
      )}
    </button>
  );
}

function MenuDivider() {
  return <div className="-mx-1 my-1 h-px bg-border" />;
}

export function TabContextMenu({
  position,
  instanceId,
  tileId: _tileId,
  isPinned,
  tabCount,
  onClose,
  onCloseTab,
  onCloseOthers,
  onCloseAll,
  onTogglePin,
}: TabContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    if (position) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleEscape);
      };
    }
  }, [position, onClose]);

  // Adjust position to stay within viewport
  const adjustedPosition = useCallback(() => {
    if (!position || !menuRef.current) return position;

    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let { x, y } = position;

    if (x + rect.width > viewportWidth) {
      x = viewportWidth - rect.width - 8;
    }

    if (y + rect.height > viewportHeight) {
      y = viewportHeight - rect.height - 8;
    }

    return { x, y };
  }, [position]);

  if (!position || !instanceId) return null;

  const pos = adjustedPosition() || position;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] bg-popover rounded-lg shadow-glass p-1 overflow-hidden animate-[pop-in_120ms_ease-out]"
      style={{
        left: pos.x,
        top: pos.y,
      }}
    >
      {/* Close action */}
      <MenuItem
        icon={<X className="w-4 h-4" />}
        label="Close"
        shortcut="⌘W"
        onClick={() => {
          onCloseTab();
          onClose();
        }}
      />

      {/* Close Others action */}
      <MenuItem
        icon={<XCircle className="w-4 h-4" />}
        label="Close Others"
        disabled={tabCount <= 1}
        onClick={() => {
          onCloseOthers();
          onClose();
        }}
      />

      {/* Close All action */}
      <MenuItem
        icon={<XCircle className="w-4 h-4" />}
        label="Close All"
        onClick={() => {
          onCloseAll();
          onClose();
        }}
      />

      <MenuDivider />

      {/* Pin/Unpin action */}
      <MenuItem
        icon={isPinned ? <PushPinSlash className="w-4 h-4" /> : <PushPin className="w-4 h-4" />}
        label={isPinned ? 'Unpin Tab' : 'Pin Tab'}
        onClick={() => {
          onTogglePin();
          onClose();
        }}
      />
    </div>
  );
}
