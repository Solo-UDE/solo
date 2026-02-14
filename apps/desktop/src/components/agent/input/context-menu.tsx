/**
 * ContextMenu - "+" button dropdown for adding attachments, images, and file mentions
 */

import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Image, Paperclip, Plus } from 'lucide-react';
import React, { useCallback } from 'react';

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { useAttachmentStore } from '../../../stores/attachmentStore';
import { IMAGE_EXTENSIONS, isImageFile, getFileName, createAttachmentId } from '../../../lib/attachmentHelpers';

import type { Attachment } from '../../../stores/agentStore';

export interface ContextMenuProps {
	disabled?: boolean;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
	disabled = false,
}) => {
	const addAttachment = useAttachmentStore((s) => s.addAttachment);

	const handleAddFile = useCallback(async () => {
		try {
			const selected = await open({
				multiple: true,
				directory: false,
				title: 'Add attachment',
			});
			if (!selected) return;

			const paths = Array.isArray(selected) ? selected : [selected];
			for (const filePath of paths) {
				const name = getFileName(filePath);
				const isImage = isImageFile(filePath);
				const attachment: Attachment = {
					id: createAttachmentId(),
					type: isImage ? 'image' : 'file',
					path: filePath,
					name,
					thumbnailUrl: isImage ? convertFileSrc(filePath) : undefined,
				};
				addAttachment(attachment);
			}
		} catch (err) {
			console.error('Failed to open file dialog:', err);
		}
	}, [addAttachment]);

	const handleAddImage = useCallback(async () => {
		try {
			const selected = await open({
				multiple: true,
				directory: false,
				title: 'Add image',
				filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }],
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
		} catch (err) {
			console.error('Failed to open image dialog:', err);
		}
	}, [addAttachment]);

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				disabled={disabled}
				className={`
					inline-flex items-center justify-center
					h-8 w-8 rounded-md
					border border-border bg-background
					hover:bg-muted hover:border-border
					focus:outline-none focus:ring-2 focus:ring-ring
					transition-colors
					${disabled ? 'opacity-50 cursor-not-allowed' : ''}
				`}
				aria-label="Add context"
			>
				<Plus className="h-4 w-4 text-foreground" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-52">
				<DropdownMenuItem
					onClick={handleAddFile}
					className="flex items-center gap-2 cursor-pointer"
				>
					<Paperclip className="h-4 w-4" />
					<span>Add Attachment</span>
				</DropdownMenuItem>
				<DropdownMenuItem
					onClick={handleAddImage}
					className="flex items-center gap-2 cursor-pointer"
				>
					<Image className="h-4 w-4" />
					<span>Add Image</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
