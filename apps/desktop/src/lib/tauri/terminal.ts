/**
 * Tauri IPC wrappers for terminal commands
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * Spawn a new PTY process and return its ID.
 */
export async function createTerminal(
	cwd?: string,
	shell?: string,
	env?: Record<string, string>,
	cols?: number,
	rows?: number,
): Promise<string> {
	return invoke<string>('spawn_pty', { cwd, shell, cols, rows, env });
}

/**
 * Write data to a terminal's stdin.
 */
export async function writeTerminal(id: string, data: string): Promise<void> {
	return invoke<void>('write_pty', { id, data });
}

/**
 * Resize a terminal.
 */
export async function resizeTerminal(
	id: string,
	cols: number,
	rows: number,
): Promise<void> {
	return invoke<void>('resize_pty', { id, cols, rows });
}

/**
 * Kill a terminal process.
 */
export async function killTerminal(id: string): Promise<void> {
	return invoke<void>('kill_pty', { id });
}
