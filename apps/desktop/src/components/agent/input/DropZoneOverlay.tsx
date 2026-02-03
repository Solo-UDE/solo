/**
 * DropZoneOverlay - Drag-and-drop zone that wraps the editor area.
 * Handles both react-dnd drops (from file tree) and native HTML5 drops (from OS).
 */

import { useDrop } from 'react-dnd';
import { Upload } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { DND_ITEM_TYPES } from '../../file-explorer/FileTreeNode';
import { useAttachmentStore } from '../../../stores/attachmentStore';

import type { FileTreeDragItem } from '../../file-explorer/FileTreeNode';
import type { Attachment } from '../../../stores/agentStore';
import type { FC, ReactNode } from 'react';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico']);

function isImageFile(name: string): boolean {
	const dot = name.lastIndexOf('.');
	if (dot < 0) return false;
	return IMAGE_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

function createAttachmentId(): string {
	return `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface DropZoneOverlayProps {
	disabled?: boolean;
	children: ReactNode;
}

export const DropZoneOverlay: FC<DropZoneOverlayProps> = ({ disabled, children }) => {
	const [isNativeDragOver, setIsNativeDragOver] = useState(false);
	const dragCounterRef = useRef(0);
	const addAttachment = useAttachmentStore((s) => s.addAttachment);

	const handleFileTreeDrop = useCallback(
		(item: FileTreeDragItem) => {
			if (disabled) return;

			const isImage = isImageFile(item.name);
			const attachment: Attachment = {
				id: createAttachmentId(),
				type: isImage ? 'image' : 'file',
				path: item.path,
				name: item.name,
				thumbnailUrl: isImage ? convertFileSrc(item.path) : undefined,
			};
			addAttachment(attachment);
		},
		[disabled, addAttachment]
	);

	// react-dnd drop target for file tree nodes
	const [{ isOver: isDndOver }, dropRef] = useDrop({
		accept: DND_ITEM_TYPES.FILE_TREE_NODE,
		drop: (item: FileTreeDragItem) => {
			handleFileTreeDrop(item);
		},
		collect: (monitor) => ({
			isOver: monitor.isOver(),
		}),
	});

	// Native drag handlers for OS file drops
	const handleDragEnter = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			dragCounterRef.current++;
			if (e.dataTransfer.types.includes('Files')) {
				setIsNativeDragOver(true);
			}
		},
		[]
	);

	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
	}, []);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		dragCounterRef.current--;
		if (dragCounterRef.current === 0) {
			setIsNativeDragOver(false);
		}
	}, []);

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			dragCounterRef.current = 0;
			setIsNativeDragOver(false);

			if (disabled) return;

			const files = Array.from(e.dataTransfer.files);
			for (const file of files) {
				const isImage = isImageFile(file.name);
				// In Tauri, dropped files have a .path property
				const filePath = (file as File & { path?: string }).path || file.name;

				const attachment: Attachment = {
					id: createAttachmentId(),
					type: isImage ? 'image' : 'file',
					path: filePath,
					name: file.name,
					mimeType: file.type || undefined,
					size: file.size,
					thumbnailUrl: isImage ? convertFileSrc(filePath) : undefined,
				};
				addAttachment(attachment);
			}
		},
		[disabled, addAttachment]
	);

	const showOverlay = isNativeDragOver || isDndOver;

	return (
		<div
			ref={dropRef as unknown as React.Ref<HTMLDivElement>}
			onDragEnter={handleDragEnter}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
			className="relative"
		>
			{children}
			{showOverlay && (
				<div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary/50 bg-primary/5 backdrop-blur-[1px] pointer-events-none">
					<Upload className="w-8 h-8 text-primary/60" />
					<span className="text-sm font-medium text-primary/80">Drop files here</span>
					<span className="text-xs text-muted-foreground">
						Images, PDFs, text files, or folders
					</span>
				</div>
			)}
		</div>
	);
};
