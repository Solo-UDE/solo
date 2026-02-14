/**
 * DropZoneOverlay - Drag-and-drop zone that wraps the editor area.
 * Handles both in-app file tree drops (via mouse events + shared drag store)
 * and OS file drops (via Tauri v2's onDragDropEvent).
 */

import { Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { useDragStore } from '../../../stores/dragStore';
import { useAttachmentStore } from '../../../stores/attachmentStore';
import { isImageFile, createAttachmentId, getFileName } from '../../../lib/attachmentHelpers';

import type { DragPayload } from '../../../stores/dragStore';
import type { Attachment } from '../../../stores/agentStore';
import type { FC, ReactNode } from 'react';

export interface DropZoneOverlayProps {
	disabled?: boolean;
	children: ReactNode;
}

export const DropZoneOverlay: FC<DropZoneOverlayProps> = ({ disabled, children }) => {
	const [isNativeDragOver, setIsNativeDragOver] = useState(false);
	const [isMouseDragOver, setIsMouseDragOver] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const addAttachment = useAttachmentStore((s) => s.addAttachment);
	const disabledRef = useRef(disabled);
	disabledRef.current = disabled;

	const dragActive = useDragStore((s) => s.active);
	const endDrag = useDragStore((s) => s.endDrag);

	const handleFileTreeDrop = useCallback(
		(item: DragPayload) => {
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

	// Track mouse enter/leave on the drop zone during an active file tree drag
	const handleMouseEnter = useCallback(() => {
		if (dragActive) {
			setIsMouseDragOver(true);
		}
	}, [dragActive]);

	const handleMouseLeave = useCallback(() => {
		setIsMouseDragOver(false);
	}, []);

	// Listen for mouseup on the document: if the drag store has an active drag
	// and the cursor is over this drop zone, process the drop
	useEffect(() => {
		const handleMouseUp = (e: MouseEvent) => {
			const payload = useDragStore.getState().payload;
			const active = useDragStore.getState().active;
			if (!active || !payload) return;

			const el = containerRef.current;
			if (el) {
				const rect = el.getBoundingClientRect();
				const inside =
					e.clientX >= rect.left &&
					e.clientX <= rect.right &&
					e.clientY >= rect.top &&
					e.clientY <= rect.bottom;
				if (inside) {
					handleFileTreeDrop(payload);
				}
			}
			setIsMouseDragOver(false);
			endDrag();
		};

		document.addEventListener('mouseup', handleMouseUp);
		return () => document.removeEventListener('mouseup', handleMouseUp);
	}, [handleFileTreeDrop, endDrag]);

	// Tauri v2 native drag-drop event listener for OS file drops
	useEffect(() => {
		let unlisten: (() => void) | undefined;

		getCurrentWebview()
			.onDragDropEvent((event) => {
				try {
					const payload = event.payload;
					const type = payload.type;

					if (type === 'enter') {
						setIsNativeDragOver(true);
					} else if (type === 'leave' || type === 'cancelled') {
						setIsNativeDragOver(false);
					} else if (type === 'over' || type === 'hover') {
						// Tauri v2 fires 'over'/'hover' continuously — ignore
					} else if (type === 'drop') {
						setIsNativeDragOver(false);
						if (disabledRef.current) return;

						const paths = (payload as { paths?: string[] }).paths;
						if (!paths || paths.length === 0) return;
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
				} catch (err) {
					console.error('[DropZone] ERROR in Tauri onDragDropEvent handler:', err);
				}
			})
			.then((fn) => {
				unlisten = fn;
			})
			.catch((err) => {
				console.error('[DropZone] FAILED to register Tauri onDragDropEvent listener:', err);
			});

		return () => {
			unlisten?.();
		};
	}, [addAttachment]);

	// Prevent browser default drag/drop behavior (navigating to the file)
	const handleBrowserDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
	}, []);

	const handleBrowserDrop = useCallback((e: React.DragEvent) => {
		e.preventDefault();
	}, []);

	const showOverlay = isNativeDragOver || isMouseDragOver;

	return (
		<div
			ref={containerRef}
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
			onDragOver={handleBrowserDragOver}
			onDrop={handleBrowserDrop}
			className="relative"
		>
			{children}
			{showOverlay && (
				<div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary/50 bg-background/80 backdrop-blur-sm pointer-events-none">
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
