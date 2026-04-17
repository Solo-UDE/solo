/**
 * Worktree Logger — structured, timestamped logs for every worktree operation.
 *
 * Filter in DevTools console with: `[wt]`
 *
 * Usage:
 *   wtLog('info', 'something happened', { worktreeId: 'abc' });
 *
 *   await wtTrace('remove worktree', { worktreeId: id }, () =>
 *     worktreeApi.removeWorktree({ id, force: false })
 *   );
 *
 * Diagnostics from console:
 *   wtDumpDiagnostics()
 */

import type { WorktreeInfo } from '../bindings';

type LogLevel = 'info' | 'warn' | 'error' | 'success';

const PREFIX = '[wt]';

export interface WtLogContext {
	action?: string;
	worktreeId?: string;
	path?: string;
	existsOnDisk?: boolean;
	durationMs?: number;
	error?: string;
	[key: string]: unknown;
}

function nowHHMMSSmmm(): string {
	const d = new Date();
	const hh = String(d.getHours()).padStart(2, '0');
	const mm = String(d.getMinutes()).padStart(2, '0');
	const ss = String(d.getSeconds()).padStart(2, '0');
	const ms = String(d.getMilliseconds()).padStart(3, '0');
	return `${hh}:${mm}:${ss}.${ms}`;
}

export function wtLog(level: LogLevel, message: string, context?: WtLogContext): void {
	const fmt = `${PREFIX} ${nowHHMMSSmmm()} ${message}`;
	switch (level) {
		case 'info':
			console.info(fmt, context ?? '');
			break;
		case 'warn':
			console.warn(fmt, context ?? '');
			break;
		case 'error':
			console.error(fmt, context ?? '');
			break;
		case 'success':
			// Green text in DevTools so success stands out from the noise.
			console.log(`%c${fmt}`, 'color: #16a34a; font-weight: 500', context ?? '');
			break;
	}
}

/**
 * Wrap an async operation with start/end traces and timing.
 * Errors are logged AND re-thrown so the caller can still react.
 */
export async function wtTrace<T>(
	action: string,
	context: Omit<WtLogContext, 'action' | 'durationMs' | 'error'>,
	fn: () => Promise<T>,
): Promise<T> {
	const start = performance.now();
	wtLog('info', `→ ${action}`, { action, ...context });
	try {
		const result = await fn();
		const durationMs = Math.round(performance.now() - start);
		wtLog('success', `✓ ${action} (${durationMs}ms)`, { action, ...context, durationMs });
		return result;
	} catch (err) {
		const durationMs = Math.round(performance.now() - start);
		const errorMsg = err instanceof Error ? err.message : String(err);
		wtLog('error', `✗ ${action} failed (${durationMs}ms): ${errorMsg}`, {
			action,
			...context,
			durationMs,
			error: errorMsg,
		});
		throw err;
	}
}

/**
 * Brief snapshot of a WorktreeInfo for log payloads — keeps logs scannable
 * while still capturing the fields most relevant to debugging.
 */
export function wtSnapshot(wt: WorktreeInfo): WtLogContext {
	return {
		worktreeId: wt.id,
		path: wt.path,
		existsOnDisk: wt.exists_on_disk,
		isMain: wt.is_main,
		isLocked: wt.is_locked,
		isDirty: wt.is_dirty,
		branch: wt.branch ?? undefined,
	};
}

/**
 * Console-callable diagnostic dump. From DevTools:
 *   wtDumpDiagnostics()
 *
 * Prints a complete snapshot of worktree, git, and filesystem state.
 * Useful for filing bug reports or pasting back to support.
 */
export async function wtDumpDiagnostics(): Promise<void> {
	const { useWorktreeStore } = await import('@/stores/worktreeStore');
	const { useGitStore } = await import('@/stores/gitStore');
	const { useFileExplorerStore } = await import('@/stores/fileExplorerStore');
	const { useRepoStore } = await import('@/stores/repoStore');

	const wt = useWorktreeStore.getState();
	const git = useGitStore.getState();
	const fs = useFileExplorerStore.getState();
	const repo = useRepoStore.getState();

	console.group(`${PREFIX} ${nowHHMMSSmmm()} === DIAGNOSTIC DUMP ===`);
	console.log('active repo:', repo.activeRepoPath);
	console.log('workspace root:', fs.rootPath);
	console.log('active worktreeId:', wt.activeWorktreeId);
	console.log('worktree count:', wt.worktrees.size);
	console.table(
		Array.from(wt.worktrees.values()).map((w) => ({
			id: w.id,
			branch: w.branch ?? '—',
			exists_on_disk: w.exists_on_disk,
			is_main: w.is_main,
			is_locked: w.is_locked,
			is_dirty: w.is_dirty,
			path: w.path,
		})),
	);
	console.log('git current branch:', git.currentBranch);
	console.log('git branches loaded:', git.branches.length);
	console.log('git stash entries:', git.stashEntries.length);
	console.log('git poll active:', git.pollIntervalId !== null);
	console.log('worktreeStore error:', wt.error);
	console.groupEnd();
}

// Expose on window so users can call from DevTools console without imports.
declare global {
	interface Window {
		wtDumpDiagnostics: typeof wtDumpDiagnostics;
	}
}
if (typeof window !== 'undefined') {
	window.wtDumpDiagnostics = wtDumpDiagnostics;
}
