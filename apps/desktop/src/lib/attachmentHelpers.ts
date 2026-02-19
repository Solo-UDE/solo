/**
 * Shared attachment utility helpers.
 * Used by DropZoneOverlay, ContextMenu, and any other attachment producers.
 */

/** Image extensions without leading dots (for Tauri dialog filters) */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];

/** Set of dotted image extensions for fast lookup */
const IMAGE_EXTENSION_SET = new Set(IMAGE_EXTENSIONS.map((ext) => `.${ext}`));

export function isImageFile(name: string): boolean {
	const dot = name.lastIndexOf('.');
	if (dot < 0) return false;
	return IMAGE_EXTENSION_SET.has(name.slice(dot).toLowerCase());
}

export function getFileName(path: string): string {
	const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
	return lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
}

export function createAttachmentId(): string {
	return `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
