import { Plus, Image, File } from '@phosphor-icons/react';
import React, { useCallback } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { toolbarButtonIconOnly } from './toolbar-button-class';
import { cn } from '@/lib/utils';
import { useAttachmentStore } from '../../../stores/attachmentStore';
import { isImageFile, createAttachmentId, getFileName } from '../../../lib/attachmentHelpers';

import type { Attachment } from '../../../stores/agentStore';

export interface ContextMenuProps {
  disabled?: boolean;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  disabled = false,
}) => {
  const addAttachment = useAttachmentStore((s) => s.addAttachment);

  const handleAddFile = useCallback(async () => {
    const selected = await open({
      multiple: true,
      title: 'Add Files',
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    for (const filePath of paths) {
      const name = getFileName(filePath);
      const isImage = isImageFile(name);
      const attachment: Attachment = {
        id: createAttachmentId(),
        type: isImage ? 'image' : 'file',
        path: filePath,
        name,
        thumbnailUrl: isImage ? convertFileSrc(filePath) : undefined,
      };
      addAttachment(attachment);
    }
  }, [addAttachment]);

  const handleAddImage = useCallback(async () => {
    const selected = await open({
      multiple: true,
      title: 'Add Images',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    for (const filePath of paths) {
      const name = getFileName(filePath);
      const attachment: Attachment = {
        id: createAttachmentId(),
        type: 'image',
        path: filePath,
        name,
        thumbnailUrl: convertFileSrc(filePath),
      };
      addAttachment(attachment);
    }
  }, [addAttachment]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(
          toolbarButtonIconOnly,
          disabled && 'opacity-50 cursor-not-allowed',
        )}
        aria-label="Add context"
      >
        <Plus className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem onClick={handleAddFile}>
          <File className="h-4 w-4" />
          <span>Add File</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleAddImage}>
          <Image className="h-4 w-4" />
          <span>Add Image</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
