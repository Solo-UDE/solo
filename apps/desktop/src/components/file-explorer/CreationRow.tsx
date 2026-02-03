/**
 * CreationRow - Inline ghost row for creating new files/folders in the file tree
 */

import React, { useCallback, useState } from 'react';
import { FileIcon, FolderIcon } from '@react-symbols/icons/utils';

interface CreationRowProps {
  type: 'file' | 'folder';
  depth: number;
  style: React.CSSProperties;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

export function CreationRow({ type, depth, style, onSubmit, onCancel }: CreationRowProps) {
  const [value, setValue] = useState('');

  const commit = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed) {
      onSubmit(trimmed);
    } else {
      onCancel();
    }
  }, [value, onSubmit, onCancel]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    },
    [commit, onCancel]
  );

  const paddingLeft = depth * 16 + 8;

  return (
    <div
      style={style}
      className="flex items-center h-7 px-2 select-none"
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="flex items-center gap-1 flex-1 min-w-0"
        style={{ paddingLeft }}
      >
        {/* Spacer matching the caret column */}
        <div className="w-4 h-4 shrink-0" />

        {/* Icon updates dynamically as the user types */}
        <span className="shrink-0">
          {type === 'folder' ? (
            <FolderIcon folderName={value || ''} className="w-4 h-4" />
          ) : (
            <FileIcon fileName={value || ''} autoAssign className="w-4 h-4" />
          )}
        </span>

        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commit}
          autoFocus
          placeholder={type === 'file' ? 'filename' : 'folder name'}
          className="flex-1 min-w-0 px-1 py-0 text-sm bg-muted border border-primary rounded outline-none"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
}
