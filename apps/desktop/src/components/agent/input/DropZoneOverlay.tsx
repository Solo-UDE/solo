/**
 * DropZoneOverlay - Drag-and-drop zone that wraps the editor area.
 * Handles both react-dnd drops (from file tree) and native Tauri v2 drops (from OS).
 */

import { useDrop } from 'react-dnd';
import { Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { DND_ITEM_TYPES } from '../../file-explorer/FileTreeNode';
import { useAttachmentStore } from '../../../stores/attachmentStore';
import { isImageFile, createAttachmentId, getFileName } from '../../../lib/attachmentHelpers';

import type { FileTreeDragItem } from '../../file-explorer/FileTreeNode';
import type { Attachment } from '../../../stores/agentStore';
import type { FC, ReactNode } from 'react';

export interface DropZoneOverlayProps {
	disabled?: boolean;
	children: ReactNode;
}

export const DropZoneOverlay: FC<DropZoneOverlayProps> = ({ disabled, children }) => {
	const [isNativeDragOver, setIsNativeDragOver] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const addAttachment = useAttachmentStore((s) => s.addAttachment);
	const disabledRef = useRef(disabled);
	disabledRef.current = disabled;

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

	// Combine drop ref with container ref via callback ref
	const combinedDropRef = useCallback(
		(node: HTMLDivElement | null) => {
			containerRef.current = node;
			dropRef(node);
		},
		[dropRef]
	);

	// Tauri v2 native drag-drop event listener for OS file drops
	useEffect(() => {
		let unlisten: (() => void) | undefined;

		getCurrentWindow()
			.onDragDropEvent((event) => {
				const { type } = event.payload;

				if (type === 'enter') {
					setIsNativeDragOver(true);
				} else if (type === 'leave') {
					setIsNativeDragOver(false);
				} else if (type === 'drop') {
					setIsNativeDragOver(false);
					if (disabledRef.current) return;

					const { paths } = event.payload;
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
				}
			})
			.then((fn) => {
				unlisten = fn;
			});

		return () => {
			unlisten?.();
		};
	}, [addAttachment]);

	const showOverlay = isNativeDragOver || isDndOver;

	return (
		<div
			ref={combinedDropRef}
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
