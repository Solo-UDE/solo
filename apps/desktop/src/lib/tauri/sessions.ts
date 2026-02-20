/**
 * Tauri IPC wrappers for session persistence commands.
 *
 * Maps to `session_commands.rs` — manages `~/.solo/sessions/` on disk.
 */

import { invoke } from '@tauri-apps/api/core';

/** Get the sessions directory path, creating it if needed. */
export const sessionGetDir = () =>
  invoke<string>('session_get_dir');

/** List all session IDs (filenames without .json extension). */
export const sessionListFiles = () =>
  invoke<string[]>('session_list_files');

/** Read a session file by ID. Returns raw JSON string. */
export const sessionReadFile = (sessionId: string) =>
  invoke<string>('session_read_file', { sessionId });

/** Write a session file atomically (write .tmp then rename). */
export const sessionWriteFile = (sessionId: string, content: string) =>
  invoke<void>('session_write_file', { sessionId, content });

/** Delete a session file by ID. */
export const sessionDeleteFile = (sessionId: string) =>
  invoke<void>('session_delete_file', { sessionId });
