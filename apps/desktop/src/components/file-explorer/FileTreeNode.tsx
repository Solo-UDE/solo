/**
 * FileTreeNode - Individual file/folder row in the tree
 */

import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import {
  CaretRight,
  CircleNotch,
  DotsThree,
  FilePlus,
  FolderPlus,
  PencilSimple,
  Trash,
  Copy,
  FolderOpen,
  Terminal,
} from '@phosphor-icons/react';
import { useDragStore } from '../../stores/dragStore';
import { FileIcon, FolderIcon } from '@react-symbols/icons/utils';
import { Git } from '@react-symbols/icons/files';
import { FolderGray, FolderGithub } from '@react-symbols/icons/folders';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from '../ui/dropdown-menu';
import type { FileTreeEntry } from '../../bindings';

interface FileTreeNodeProps {
  entry: FileTreeEntry;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  isLoading: boolean;
  isRenaming: boolean;
  style: React.CSSProperties;
  onToggle: () => void;
  onClick: (event: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onRenameSubmit: (newName: string) => void;
  onRenameCancel: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onStartRename: () => void;
  onDelete: () => void;
  onCopyPath: () => void;
  onRevealInFinder: () => void;
  onOpenInTerminal?: () => void;
}

// Custom mappings for files without extensions (git internals)
const customFileNameMappings = {
  COMMIT_EDITMSG: Git,
  HEAD: Git,
  FETCH_HEAD: Git,
  ORIG_HEAD: Git,
  config: Git,
  description: Git,
  index: Git,
  stash: Git,
  'packed-refs': Git,
  MERGE_HEAD: Git,
  MERGE_MSG: Git,
  REBASE_HEAD: Git,
  BISECT_LOG: Git,
};

// Custom mappings for git internal folders (only those without library defaults)
// Note: 'hooks' is intentionally omitted - the library provides FolderHooks by default
// which is semantically appropriate for both .git/hooks and React hooks folders
const customFolderMappings = {
  info: FolderGray,
  logs: FolderGray,
  objects: FolderGray,
  refs: FolderGithub,
  worktrees: FolderGithub,
  heads: FolderGithub,
  remotes: FolderGithub,
  tags: FolderGithub,
};

// File/folder icon using react-symbols (auto-assigns based on filename)
function getFileIcon(name: string, isDir: boolean, _isExpanded: boolean) {
  if (isDir) {
    return (
      <FolderIcon
        folderName={name}
        editFolderNameData={customFolderMappings}
        className="w-4 h-4"
      />
    );
  }
  // autoAssign enables special icon matching for files like vite.config.ts, tsconfig.json, etc.
  return (
    <FileIcon
      fileName={name}
      autoAssign
      editFileNameData={customFileNameMappings}
      className="w-4 h-4"
    />
  );
}

export const FileTreeNode = memo(function FileTreeNode({
  entry,
  depth,
  isExpanded,
  isSelected,
  isLoading,
  isRenaming,
  style,
  onToggle,
  onClick,
  onDoubleClick,
  onRenameSubmit,
  onRenameCancel,
  onNewFile,
  onNewFolder,
  onStartRename,
  onDelete,
  onCopyPath,
  onRevealInFinder,
  onOpenInTerminal,
}: FileTreeNodeProps) {
  const [renameValue, setRenameValue] = useState(entry.name);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const mouseStartRef = useRef<{ x: number; y: number } | null>(null);
  const startDrag = useDragStore((s) => s.startDrag);
  const activateDrag = useDragStore((s) => s.activateDrag);

  // B3: Right-click context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClick(e); // Select the item
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, [onClick]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null); };
    window.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [contextMenu]);

  // Sync rename value when entry name changes (e.g., after external rename)
  useEffect(() => {
    setRenameValue(entry.name);
  }, [entry.name]);

  // Drag-to-chat: mouse-threshold logic for files (not directories)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (entry.is_dir || isRenaming) return;
    mouseStartRef.current = { x: e.clientX, y: e.clientY };
    startDrag({ path: entry.path, name: entry.name, isDir: false });
  }, [entry.path, entry.name, entry.is_dir, isRenaming, startDrag]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!mouseStartRef.current) return;
      const dx = e.clientX - mouseStartRef.current.x;
      const dy = e.clientY - mouseStartRef.current.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        activateDrag();
        mouseStartRef.current = null;
      }
    };
    const handleMouseUp = () => {
      mouseStartRef.current = null;
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activateDrag]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (renameValue.trim() && renameValue !== entry.name) {
          onRenameSubmit(renameValue.trim());
        } else {
          onRenameCancel();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onRenameCancel();
      }
    },
    [renameValue, entry.name, onRenameSubmit, onRenameCancel]
  );

  const handleRenameBlur = useCallback(() => {
    if (renameValue.trim() && renameValue !== entry.name) {
      onRenameSubmit(renameValue.trim());
    } else {
      onRenameCancel();
    }
  }, [renameValue, entry.name, onRenameSubmit, onRenameCancel]);

  const paddingLeft = depth * 8;

  return (
    <div
      style={style}
      className={`
        group flex items-center h-7 px-2 cursor-pointer select-none
        hover:bg-muted/50 active:bg-muted/70
        transition-colors duration-100
        ${isSelected ? 'bg-primary/20 hover:bg-primary/30' : ''}
      `}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
    >
      <div
        className="flex items-center gap-1 flex-1 min-w-0"
        style={{ paddingLeft }}
      >
        {/* Expand/collapse button for directories */}
        {entry.is_dir ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className="w-4 h-4 flex items-center justify-center shrink-0 hover:text-foreground rounded"
            aria-label={isExpanded ? `Collapse ${entry.name}` : `Expand ${entry.name}`}
          >
            {isLoading ? (
              <CircleNotch weight="bold" className="w-3 h-3 animate-spin text-muted-foreground" />
            ) : (
              <CaretRight className={`w-3 h-3 text-muted-foreground transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`} />
            )}
          </button>
        ) : (
          <div className="w-4 h-4 shrink-0" />
        )}

        {/* File/folder icon */}
        <span className="shrink-0">
          {getFileIcon(entry.name, entry.is_dir, isExpanded)}
        </span>

        {/* File name or rename input */}
        {isRenaming ? (
          <input
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={handleRenameBlur}
            autoFocus
            aria-label={`Rename ${entry.name}`}
            className="flex-1 min-w-0 px-1 py-0 text-xs font-medium bg-muted border border-primary rounded outline-none"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate text-xs font-medium text-foreground">{entry.name}</span>
        )}
      </div>

      {/* Three-dot dropdown menu */}
      {!isRenaming && (
        <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity duration-150 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="p-0.5 rounded-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={(e) => e.stopPropagation()}
                aria-label={`Actions for ${entry.name}`}
              >
                <DotsThree weight="bold" className="h-4 w-4" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" className="w-48">
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onNewFile(); }}>
                <FilePlus className="h-3.5 w-3.5" /> New File
              </DropdownMenuItem>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onNewFolder(); }}>
                <FolderPlus className="h-3.5 w-3.5" /> New Folder
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onStartRename(); }}>
                <PencilSimple className="h-3.5 w-3.5" /> Rename
                <DropdownMenuShortcut>F2</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="text-destructive focus:text-destructive"
              >
                <Trash className="h-3.5 w-3.5" /> Delete
                <DropdownMenuShortcut>Del</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onCopyPath(); }}>
                <Copy className="h-3.5 w-3.5" /> Copy Path
              </DropdownMenuItem>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRevealInFinder(); }}>
                <FolderOpen className="h-3.5 w-3.5" /> Reveal in Finder
              </DropdownMenuItem>
              {entry.is_dir && onOpenInTerminal && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onOpenInTerminal(); }}>
                    <Terminal className="h-3.5 w-3.5" /> Open in Terminal
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* B3: Right-click context menu */}
      {contextMenu && !isRenaming && (
        <ContextMenuPortal
          x={contextMenu.x}
          y={contextMenu.y}
          entry={entry}
          onNewFile={onNewFile}
          onNewFolder={onNewFolder}
          onStartRename={onStartRename}
          onDelete={onDelete}
          onCopyPath={onCopyPath}
          onRevealInFinder={onRevealInFinder}
          onOpenInTerminal={onOpenInTerminal}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
});

// B3: Context menu rendered as a portal
function ContextMenuPortal({
  x,
  y,
  entry,
  onNewFile,
  onNewFolder,
  onStartRename,
  onDelete,
  onCopyPath,
  onRevealInFinder,
  onOpenInTerminal,
  onClose,
}: {
  x: number;
  y: number;
  entry: FileTreeEntry;
  onNewFile: () => void;
  onNewFolder: () => void;
  onStartRename: () => void;
  onDelete: () => void;
  onCopyPath: () => void;
  onRevealInFinder: () => void;
  onOpenInTerminal?: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Adjust position to keep menu in viewport
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${y - rect.height}px`;
    }
    if (rect.right > window.innerWidth) {
      menu.style.left = `${x - rect.width}px`;
    }
  }, [x, y]);

  const handleAction = (action: () => void) => {
    action();
    onClose();
  };

  return ReactDOM.createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] bg-popover border border-border/50 rounded-lg shadow-[0_8px_32px_-8px_rgba(0,0,0,0.3)] py-1 animate-in fade-in-0 zoom-in-95 duration-100"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <ContextMenuItem onClick={() => handleAction(onNewFile)} icon={FilePlus} label="New File" />
      <ContextMenuItem onClick={() => handleAction(onNewFolder)} icon={FolderPlus} label="New Folder" />
      <div className="h-px bg-border/50 my-1" />
      <ContextMenuItem onClick={() => handleAction(onStartRename)} icon={PencilSimple} label="Rename" shortcut="F2" />
      <ContextMenuItem onClick={() => handleAction(onDelete)} icon={Trash} label="Delete" shortcut="Del" destructive />
      <div className="h-px bg-border/50 my-1" />
      <ContextMenuItem onClick={() => handleAction(onCopyPath)} icon={Copy} label="Copy Path" />
      <ContextMenuItem onClick={() => handleAction(onRevealInFinder)} icon={FolderOpen} label="Reveal in Finder" />
      {entry.is_dir && onOpenInTerminal && (
        <>
          <div className="h-px bg-border/50 my-1" />
          <ContextMenuItem onClick={() => handleAction(onOpenInTerminal)} icon={Terminal} label="Open in Terminal" />
        </>
      )}
    </div>,
    document.body
  );
}

function ContextMenuItem({
  onClick,
  icon: Icon,
  label,
  shortcut,
  destructive,
}: {
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  shortcut?: string;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2.5 py-1 text-sm rounded-md transition-colors ${
        destructive
          ? 'text-destructive hover:bg-destructive/10'
          : 'text-foreground hover:bg-muted/60'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="flex-1 text-left">{label}</span>
      {shortcut && <span className="text-xs text-muted-foreground/60">{shortcut}</span>}
    </button>
  );
}
