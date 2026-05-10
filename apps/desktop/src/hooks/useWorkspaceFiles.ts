/**
 * useWorkspaceFiles - Provides a flat list of all files in the workspace.
 * Backed by the shared workspace file index so mounted chat composers do not
 * each recursively scan the same workspace.
 */

import { useCallback, useEffect } from 'react';
import { useFileExplorerStore } from '../stores/fileExplorerStore';
import type { FileEntry } from '../lib/fuzzySearch';
import {
	ensureWorkspaceFileIndex,
	useWorkspaceFileIndex,
	useWorkspaceFileIndexStore,
} from '../stores/workspaceFileIndexStore';

export function useWorkspaceFiles(): {
	files: FileEntry[];
	isLoading: boolean;
	refresh: () => void;
} {
	const rootPath = useFileExplorerStore((s) => s.rootPath);
	const index = useWorkspaceFileIndex(rootPath);

	const scan = useCallback(async () => {
		if (!rootPath) return;
		await ensureWorkspaceFileIndex(rootPath);
	}, [rootPath]);

	useEffect(() => {
		// Compatibility behavior for existing callers. New hot-path mention
		// lookups should call ensureWorkspaceFileIndex only after `@` is typed.
		if (rootPath && useWorkspaceFileIndexStore.getState().indexes.has(rootPath)) {
			void scan();
		}
	}, [rootPath, scan]);

	return { files: index.files, isLoading: index.loading, refresh: scan };
}
