/**
 * Lexical plugin that intercepts clipboard paste events to handle images.
 * Reads pasted image data as base64 and adds it to the attachment store.
 */

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useEffect } from 'react';

import { createAttachmentId } from '@/lib/attachmentHelpers';
import { useAttachmentStore } from '@/stores/attachmentStore';

export function ClipboardImagePlugin(): null {
	const [editor] = useLexicalComposerContext();

	useEffect(() => {
		return editor.registerRootListener((rootElement, prevRootElement) => {
			if (prevRootElement !== null) {
				prevRootElement.removeEventListener('paste', handlePaste);
			}
			if (rootElement !== null) {
				rootElement.addEventListener('paste', handlePaste);
			}
		});
	}, [editor]);

	return null;
}

function handlePaste(event: ClipboardEvent): void {
	const items = event.clipboardData?.items;
	if (!items) return;

	for (const item of items) {
		if (!item.type.startsWith('image/')) continue;

		const blob = item.getAsFile();
		if (!blob) continue;

		// Prevent Lexical from inserting the image as text
		event.preventDefault();

		const mimeType = item.type;
		const reader = new FileReader();

		reader.onload = () => {
			const dataUrl = reader.result as string;
			// Strip the "data:image/...;base64," prefix to get raw base64
			const base64Data = dataUrl.split(',')[1];
			if (!base64Data) return;

			const timestamp = Date.now();
			useAttachmentStore.getState().addAttachment({
				id: createAttachmentId(),
				type: 'image',
				path: '',
				name: `clipboard-${timestamp}.png`,
				mimeType,
				thumbnailUrl: dataUrl,
				base64Data,
			});
		};

		reader.readAsDataURL(blob);

		// Only handle the first image item
		break;
	}
}
