/**
 * FileContextMenu - Right-click context menu for file explorer
 */

import { useCallback, useEffect, useRef } from 'react';
import {
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
  Copy,
  FolderOpen,
} from 'lucide-react';

interface ContextMenuPosition {
  x: number;
  y: number;
}

interface FileContextMenuProps {
  position: ContextMenuPosition | null;
  selectedPath: string | null;
  isDirectory: boolean;
  onClose: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCopyPath: () => void;
  onRevealInFinder: () => void;
}

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
  danger?: boolean;
}

function MenuItem({ icon, label, shortcut, onClick, danger }: MenuItemProps) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full flex items-center gap-3 px-3 py-1.5 text-sm
        hover:bg-muted/80 transition-colors
        ${danger ? 'text-destructive hover:bg-destructive/10' : 'text-foreground'}
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
  return <div className="h-px bg-border my-1" />;
}

export function FileContextMenu({
  position,
  selectedPath,
  isDirectory: _isDirectory, // Reserved for future use (different menu items for files vs dirs)
  onClose,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onCopyPath,
  onRevealInFinder,
}: FileContextMenuProps) {
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

  if (!position) return null;

  const pos = adjustedPosition() || position;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] bg-card border border-border rounded-lg shadow-lg py-1 overflow-hidden"
      style={{
        left: pos.x,
        top: pos.y,
      }}
    >
      {/* Create actions */}
      <MenuItem
        icon={<FilePlus className="w-4 h-4" />}
        label="New File"
        onClick={() => {
          onNewFile();
          onClose();
        }}
      />
      <MenuItem
        icon={<FolderPlus className="w-4 h-4" />}
        label="New Folder"
        onClick={() => {
          onNewFolder();
          onClose();
        }}
      />

      <MenuDivider />

      {/* Edit actions */}
      {selectedPath && (
        <>
          <MenuItem
            icon={<Pencil className="w-4 h-4" />}
            label="Rename"
            shortcut="F2"
            onClick={() => {
              onRename();
              onClose();
            }}
          />
          <MenuItem
            icon={<Trash2 className="w-4 h-4" />}
            label="Delete"
            shortcut="Del"
            danger
            onClick={() => {
              onDelete();
              onClose();
            }}
          />

          <MenuDivider />

          {/* Utility actions */}
          <MenuItem
            icon={<Copy className="w-4 h-4" />}
            label="Copy Path"
            onClick={() => {
              onCopyPath();
              onClose();
            }}
          />
          <MenuItem
            icon={<FolderOpen className="w-4 h-4" />}
            label="Reveal in Finder"
            onClick={() => {
              onRevealInFinder();
              onClose();
            }}
          />
        </>
      )}
    </div>
  );
}
