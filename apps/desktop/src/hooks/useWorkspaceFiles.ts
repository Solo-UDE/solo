/**
 * useWorkspaceFiles - Provides a flat list of all files in the workspace for @-mention search.
 * Recursively reads the workspace root via Tauri FS and caches the result.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFileExplorerStore } from '../stores/fileExplorerStore';
import { readDirectory } from '../lib/tauri/fs';
import type { FileEntry } from '../lib/fuzzySearch';
import type { FileTreeEntry } from '../bindings';

/** Directories to skip during recursive scan */
const IGNORED_DIRS = new Set([
	'.git',
	'node_modules',
	'.next',
	'.turbo',
	'dist',
	'build',
	'target',
	'.cache',
	'.vite',
	'__pycache__',
	'.DS_Store',
]);

/** Binary/non-text extensions to skip */
const IGNORED_EXTENSIONS = new Set([
	'.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg',
	'.woff', '.woff2', '.ttf', '.eot', '.otf',
	'.mp3', '.mp4', '.wav', '.avi', '.mov',
	'.zip', '.tar', '.gz', '.rar', '.7z',
	'.exe', '.dll', '.so', '.dylib',
	'.pdf', '.doc', '.docx', '.xls', '.xlsx',
]);

function getExtension(name: string): string {
	const dot = name.lastIndexOf('.');
	return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

function shouldSkipDir(name: string): boolean {
	return IGNORED_DIRS.has(name);
}

function shouldSkipFile(name: string): boolean {
	return IGNORED_EXTENSIONS.has(getExtension(name));
}

/** Maximum number of files to collect before stopping the scan */
const MAX_FILE_COUNT = 10_000;

export function useWorkspaceFiles(): {
	files: FileEntry[];
	isLoading: boolean;
	refresh: () => void;
} {
	const rootPath = useFileExplorerStore((s) => s.rootPath);
	const [files, setFiles] = useState<FileEntry[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const scanIdRef = useRef(0);

	const scan = useCallback(async () => {
		if (!rootPath) {
			setFiles([]);
			return;
		}

		const currentScanId = ++scanIdRef.current;
		setIsLoading(true);

		try {
			const result: FileEntry[] = [];
			const queue: string[] = [rootPath];

			while (queue.length > 0 && result.length < MAX_FILE_COUNT) {
				const dirPath = queue.shift()!;

				try {
					const response = await readDirectory(dirPath, 1);
					const entries: FileTreeEntry[] = response.entry.children || [];

					for (const entry of entries) {
						// Abort if a newer scan started
						if (scanIdRef.current !== currentScanId) return;

						if (entry.is_dir) {
							if (!shouldSkipDir(entry.name)) {
								queue.push(entry.path);
							}
						} else {
							if (!shouldSkipFile(entry.name)) {
								const relativePath = entry.path.startsWith(rootPath)
									? entry.path.slice(rootPath.length + 1)
									: entry.path;
								result.push({
									path: entry.path,
									name: entry.name,
									relativePath,
								});
								if (result.length >= MAX_FILE_COUNT) break;
							}
						}
					}
				} catch {
					// Skip directories that can't be read (permissions, etc.)
				}
			}

			if (scanIdRef.current === currentScanId) {
				setFiles(result);
			}
		} finally {
			if (scanIdRef.current === currentScanId) {
				setIsLoading(false);
			}
		}
	}, [rootPath]);

	useEffect(() => {
		scan();
	}, [scan]);

	return { files, isLoading, refresh: scan };
}
