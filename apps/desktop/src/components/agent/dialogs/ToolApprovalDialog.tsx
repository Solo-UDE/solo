/**
 * Tool Approval Dialog
 *
 * Compact inline permission bar matching Snowflake-V0 style.
 * Single-row layout: [Spinner] [Confirm label] [file/terminal badge] [spacer] [Reject] [Accept]
 * Keyboard shortcuts: Cmd+Enter = approve, Shift+Cmd+Backspace = reject
 */

import { type FC, useCallback, useEffect, useMemo } from 'react';
import {
	CircleNotch,
	Terminal,
	FileText,
	MagnifyingGlass,
} from '@phosphor-icons/react';
import type { PendingApproval } from '../messages/agent-message';

// =============================================================================
// Types
// =============================================================================

export interface ToolApprovalDialogProps {
	approval: PendingApproval;
	onApproved?: (requestId: string, always?: boolean) => void;
	onRejected?: (requestId: string) => void;
	className?: string;
}

export interface ToolApprovalInlineProps {
	approval: PendingApproval;
	onApproved?: (requestId: string) => void;
	onRejected?: (requestId: string) => void;
	compact?: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

/** Get confirmation action label based on tool type */
const getConfirmLabel = (toolName: string): string => {
	const name = toolName.toLowerCase();
	switch (name) {
		case 'bash': return 'Confirm run';
		case 'read': return 'Confirm read';
		case 'write': return 'Confirm write';
		case 'edit': return 'Confirm edit';
		case 'glob':
		case 'grep': return 'Confirm search';
		default: return `Confirm ${name}`;
	}
};

const getFileName = (filePath: string | undefined): string => {
	if (!filePath) return 'file';
	const parts = filePath.split('/');
	return parts[parts.length - 1] ?? filePath;
};

/** Check if tool is file-related */
const isFileTool = (toolName: string): boolean => {
	const name = toolName.toLowerCase();
	return ['read', 'write', 'edit', 'glob'].includes(name);
};

const formatInput = (input: unknown): Record<string, unknown> => {
	if (typeof input === 'object' && input !== null) {
		return input as Record<string, unknown>;
	}
	if (typeof input === 'string') {
		try { return JSON.parse(input); } catch { return { raw: input }; }
	}
	return { value: input };
};

// =============================================================================
// ToolApprovalDialog (large card variant — kept for backwards compat)
// =============================================================================

export const ToolApprovalDialog: FC<ToolApprovalDialogProps> = ({
	approval,
	onApproved,
	onRejected,
}) => {
	return (
		<ToolApprovalInline
			approval={approval}
			onApproved={(requestId) => onApproved?.(requestId)}
			onRejected={(requestId) => onRejected?.(requestId)}
		/>
	);
};

// =============================================================================
// ToolApprovalInline — Compact single-row permission bar
// =============================================================================

export const ToolApprovalInline: FC<ToolApprovalInlineProps> = ({
	approval,
	onApproved,
	onRejected,
}) => {
	const confirmLabel = getConfirmLabel(approval.toolName);
	const args = useMemo(() => formatInput(approval.toolInput), [approval.toolInput]);
	const filePath = args['file_path'] as string | undefined;
	const fileName = getFileName(filePath);
	const isBash = approval.toolName.toLowerCase() === 'bash';
	const isFile = isFileTool(approval.toolName);
	const isSearch = ['grep', 'websearch'].includes(approval.toolName.toLowerCase());

	const handleApprove = useCallback(() => {
		onApproved?.(approval.requestId);
	}, [approval.requestId, onApproved]);

	const handleDeny = useCallback(() => {
		onRejected?.(approval.requestId);
	}, [approval.requestId, onRejected]);

	// Keyboard shortcuts
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent): void => {
			if (e.metaKey || e.ctrlKey) {
				if (e.key === 'Enter') {
					e.preventDefault();
					handleApprove();
				} else if (e.shiftKey && e.key === 'Backspace') {
					e.preventDefault();
					handleDeny();
				}
			}
		};

		document.addEventListener('keydown', handleKeyDown);
		return () => { document.removeEventListener('keydown', handleKeyDown); };
	}, [handleApprove, handleDeny]);

	return (
		<div className="my-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
			<div className="flex items-center gap-2">
				{/* Spinner */}
				<CircleNotch className="h-4 w-4 text-primary animate-spin shrink-0" />

				{/* Confirm label */}
				<span className="text-sm font-medium text-primary shrink-0">{confirmLabel}</span>

				{/* Context badge: file anchor or terminal icon */}
				{isFile && filePath ? (
					<span
						className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted hover:bg-accent transition-colors min-w-0"
						title={filePath}
					>
						<FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
						<span className="text-sm truncate">{fileName}</span>
					</span>
				) : isBash ? (
					<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted">
						<Terminal className="h-3.5 w-3.5 text-muted-foreground" />
					</span>
				) : isSearch ? (
					<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted">
						<MagnifyingGlass className="h-3.5 w-3.5 text-muted-foreground" />
					</span>
				) : null}

				{/* Spacer */}
				<div className="flex-1" />

				{/* Buttons */}
				<button
					onClick={handleDeny}
					className="px-2.5 py-1 text-xs font-medium rounded transition-colors bg-muted hover:bg-accent text-foreground shrink-0"
				>
					Reject <span className="opacity-50">⇧⌘⌫</span>
				</button>
				<button
					onClick={handleApprove}
					className="px-2.5 py-1 text-xs font-medium rounded transition-colors bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
				>
					Accept <span className="opacity-50">⌘⏎</span>
				</button>
			</div>
		</div>
	);
};
