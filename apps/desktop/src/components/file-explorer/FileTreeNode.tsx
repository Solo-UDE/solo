/**
 * FileTreeNode - Individual file/folder row in the tree
 */

import React, { memo, useCallback, useEffect, useState } from 'react';
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
} from '@phosphor-icons/react';
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
}: FileTreeNodeProps) {
  const [renameValue, setRenameValue] = useState(entry.name);

  // Sync rename value when entry name changes (e.g., after external rename)
  useEffect(() => {
    setRenameValue(entry.name);
  }, [entry.name]);

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

  const paddingLeft = depth * 16 + 8;

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
            className="flex-1 min-w-0 px-1 py-0 text-sm bg-muted border border-primary rounded outline-none"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate text-sm text-foreground">{entry.name}</span>
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
              >
                <DotsThree weight="bold" className="h-4 w-4" />
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
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
});
