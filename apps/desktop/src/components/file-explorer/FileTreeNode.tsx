/**
 * FileTreeNode - Individual file/folder row in the tree
 */

import React, { memo, useCallback, useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  File,
  FileText,
  FileCode,
  FileJson,
  Image,
  Loader2,
} from 'lucide-react';
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
  onContextMenu: (event: React.MouseEvent) => void;
  onRenameSubmit: (newName: string) => void;
  onRenameCancel: () => void;
}

// File extension to icon mapping
function getFileIcon(name: string, isDir: boolean, isExpanded: boolean) {
  if (isDir) {
    return isExpanded ? (
      <FolderOpen className="w-4 h-4 text-amber-500" />
    ) : (
      <Folder className="w-4 h-4 text-amber-500" />
    );
  }

  const ext = name.split('.').pop()?.toLowerCase() ?? '';

  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'rs':
    case 'py':
    case 'go':
    case 'java':
    case 'c':
    case 'cpp':
    case 'h':
      return <FileCode className="w-4 h-4 text-blue-400" />;
    case 'json':
    case 'yaml':
    case 'yml':
    case 'toml':
      return <FileJson className="w-4 h-4 text-yellow-400" />;
    case 'md':
    case 'txt':
    case 'doc':
    case 'docx':
      return <FileText className="w-4 h-4 text-gray-400" />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
      return <Image className="w-4 h-4 text-purple-400" />;
    default:
      return <File className="w-4 h-4 text-gray-400" />;
  }
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
  onContextMenu,
  onRenameSubmit,
  onRenameCancel,
}: FileTreeNodeProps) {
  const [renameValue, setRenameValue] = useState(entry.name);

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
        flex items-center h-7 px-2 cursor-pointer select-none
        hover:bg-muted/50 active:bg-muted/70
        transition-colors duration-100
        ${isSelected ? 'bg-primary/20 hover:bg-primary/30' : ''}
      `}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
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
            className="w-4 h-4 flex items-center justify-center shrink-0 hover:bg-muted rounded"
          >
            {isLoading ? (
              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
            ) : isExpanded ? (
              <ChevronDown className="w-3 h-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-3 h-3 text-muted-foreground" />
            )}
          </button>
        ) : (
          <div className="w-4" />
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
    </div>
  );
});
