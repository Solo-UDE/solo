/**
 * Tauri file system command wrappers
 * Type-safe wrappers around Tauri invoke for file system operations
 */

import { invoke } from '@tauri-apps/api/core';
import type {
  DirectoryReadRequest,
  DirectoryReadResponse,
  FileCreateRequest,
  FileRenameRequest,
  FileDeleteRequest,
  FileReadRequest,
  FileReadResponse,
  FileTreeEntry,
  FileOperationError,
} from '../../bindings';

/**
 * Open a native folder picker dialog
 * @returns Selected folder path, or null if cancelled
 */
export async function openFolderDialog(): Promise<string | null> {
  return invoke<string | null>('open_folder_dialog');
}

/**
 * Set the workspace root path
 * @param path - Path to set as workspace root
 */
export async function setWorkspaceRoot(path: string): Promise<void> {
  return invoke('set_workspace_root', { path });
}

/**
 * Read a directory and return its contents
 * @param path - Path to the directory
 * @param depth - How deep to read (0 = no children, 1 = immediate children)
 */
export async function readDirectory(
  path: string,
  depth: number = 1
): Promise<DirectoryReadResponse> {
  const request: DirectoryReadRequest = { path, depth };
  return invoke<DirectoryReadResponse>('read_directory', { request });
}

/**
 * Read file contents
 * @param path - Path to the file
 */
export async function readFile(path: string): Promise<FileReadResponse> {
  const request: FileReadRequest = { path };
  return invoke<FileReadResponse>('read_file', { request });
}

/**
 * Write content to a file
 * @param path - Path to the file
 * @param content - Content to write
 */
export async function writeFile(path: string, content: string): Promise<void> {
  const request = { path, content };
  return invoke('write_file', { request });
}

/**
 * Create a new file
 * @param path - Path where to create the file
 * @param content - Optional initial content
 */
export async function createFile(
  path: string,
  content?: string
): Promise<FileTreeEntry> {
  const request: FileCreateRequest = {
    path,
    is_dir: false,
    content: content ?? null,
  };
  return invoke<FileTreeEntry>('create_file', { request });
}

/**
 * Create a new directory
 * @param path - Path where to create the directory
 */
export async function createDirectory(path: string): Promise<FileTreeEntry> {
  const request: FileCreateRequest = {
    path,
    is_dir: true,
    content: null,
  };
  return invoke<FileTreeEntry>('create_file', { request });
}

/**
 * Rename or move a file/directory
 * @param oldPath - Current path
 * @param newPath - New path
 */
export async function renameFile(
  oldPath: string,
  newPath: string
): Promise<FileTreeEntry> {
  const request: FileRenameRequest = {
    old_path: oldPath,
    new_path: newPath,
  };
  return invoke<FileTreeEntry>('rename_file', { request });
}

/**
 * Delete a file or directory
 * @param path - Path to delete
 * @param recursive - Whether to recursively delete directories
 */
export async function deleteFile(
  path: string,
  recursive: boolean = false
): Promise<void> {
  const request: FileDeleteRequest = { path, recursive };
  return invoke('delete_file', { request });
}

/**
 * Start watching a directory for changes
 * @param path - Path to watch
 * @param recursive - Whether to watch recursively
 */
export async function startWatching(
  path: string,
  recursive: boolean = true
): Promise<void> {
  return invoke('start_watching', { path, recursive });
}

/**
 * Stop watching for file changes
 */
export async function stopWatching(): Promise<void> {
  return invoke('stop_watching');
}

/**
 * Reveal a file or directory in Finder (macOS)
 * @param path - Path to reveal
 */
export async function revealInFinder(path: string): Promise<void> {
  return invoke('reveal_in_finder', { path });
}

/**
 * Check if an error is a FileOperationError
 */
export function isFileOperationError(error: unknown): error is FileOperationError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    'path' in error
  );
}
