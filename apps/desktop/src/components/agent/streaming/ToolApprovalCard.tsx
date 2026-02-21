/**
 * ToolApprovalCard — Redesigned permission request card with glass-morphism.
 *
 * Features:
 * - Glass container with warning accent
 * - Shield icon + "Permission Required" header
 * - Tool name + input preview
 * - Allow/Deny buttons with keyboard shortcuts
 * - Subtle border pulse animation for attention
 */

import { type FC, useCallback, useEffect, useMemo } from 'react';
import {
	ShieldWarning,
	Terminal,
	FileText,
	MagnifyingGlass,
	Globe,
	Check,
	X,
} from '@phosphor-icons/react';
import { Button } from '@solo/ui';

export interface ToolApprovalCardProps {
	readonly requestId: string;
	readonly toolName: string;
	readonly toolInput: unknown;
	readonly onApproved?: (requestId: string) => void;
	readonly onRejected?: (requestId: string) => void;
	readonly className?: string;
}

/** Get contextual icon based on tool type */
const getToolIcon = (toolName: string) => {
	const cls = 'h-4 w-4 text-muted-foreground shrink-0';
	const name = toolName.toLowerCase();
	if (name === 'bash') return <Terminal className={cls} />;
	if (['read', 'write', 'edit'].includes(name)) return <FileText className={cls} />;
	if (['glob', 'grep'].includes(name)) return <MagnifyingGlass className={cls} />;
	if (['websearch', 'webfetch'].includes(name)) return <Globe className={cls} />;
	return null;
};

/** Extract a preview string from tool input */
const getInputPreview = (toolName: string, input: Record<string, unknown>): string | undefined => {
	const name = toolName.toLowerCase();
	if (name === 'bash') return input['command'] as string | undefined;
	if (['read', 'write', 'edit'].includes(name)) return input['file_path'] as string | undefined;
	if (['glob', 'grep'].includes(name)) return input['pattern'] as string | undefined;
	if (name === 'websearch') return input['query'] as string | undefined;
	if (name === 'webfetch') return input['url'] as string | undefined;
	return undefined;
};

const formatInput = (input: unknown): Record<string, unknown> => {
	if (typeof input === 'object' && input !== null) return input as Record<string, unknown>;
	if (typeof input === 'string') {
		try { return JSON.parse(input); } catch { return { raw: input }; }
	}
	return { value: input };
};

export const ToolApprovalCard: FC<ToolApprovalCardProps> = ({
	requestId,
	toolName,
	toolInput,
	onApproved,
	onRejected,
	className = '',
}) => {
	const args = useMemo(() => formatInput(toolInput), [toolInput]);
	const preview = getInputPreview(toolName, args);
	const toolIcon = getToolIcon(toolName);

	const handleApprove = useCallback(() => {
		onApproved?.(requestId);
	}, [requestId, onApproved]);

	const handleDeny = useCallback(() => {
		onRejected?.(requestId);
	}, [requestId, onRejected]);

	// Keyboard shortcuts: Cmd+Enter = approve, Shift+Cmd+Backspace = reject
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
		<div
			className={`my-2 rounded-xl bg-warning/5 backdrop-blur-sm border border-warning/20 overflow-hidden animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ${className}`}
			role="alertdialog"
			aria-label={`Permission required for ${toolName}`}
		>
			{/* Header */}
			<div className="flex items-center gap-2 px-3 py-2.5">
				<ShieldWarning className="h-4 w-4 text-warning shrink-0" weight="fill" aria-hidden="true" />
				<span className="text-xs font-semibold text-warning">Permission Required</span>

				{/* Tool context */}
				{toolIcon ? (
					<div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-muted/40">
						{toolIcon}
						<span className="text-xs text-muted-foreground">{toolName}</span>
					</div>
				) : (
					<span className="text-xs text-muted-foreground">{toolName}</span>
				)}

				{/* Spacer */}
				<div className="flex-1" />

				{/* Action buttons */}
				<Button
					variant="ghost"
					size="sm"
					onClick={handleDeny}
					className="h-7 px-2.5 text-xs bg-muted/60 hover:bg-muted"
				>
					<X className="h-3 w-3" />
					Deny
					<kbd className="text-[9px] opacity-40 ml-0.5">⇧⌘⌫</kbd>
				</Button>
				<Button
					variant="primary"
					size="sm"
					onClick={handleApprove}
					className="h-7 px-3 text-xs"
				>
					<Check className="h-3 w-3" weight="bold" />
					Allow
					<kbd className="text-[9px] opacity-50 ml-0.5">⌘⏎</kbd>
				</Button>
			</div>

			{/* Input preview */}
			{preview ? (
				<div className="px-3 pb-2.5">
					<code className="text-xs font-mono text-muted-foreground bg-muted/30 rounded-md px-2 py-1 block truncate">
						{preview}
					</code>
				</div>
			) : null}
		</div>
	);
};
