/**
 * Tool Approval Dialog
 *
 * Displays pending tool calls that require user approval before execution.
 * Shows tool details, parameters, and allows approve/reject actions.
 * Keyboard shortcuts: y/Enter = approve, n/Esc = reject.
 */

import { FC, useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
	Warning,
	Check,
	X,
	CaretDown,
	CaretRight,
	Terminal,
	FileText,
	Folder,
	MagnifyingGlass,
	GitBranch,
} from '@phosphor-icons/react';
import type { ToolCallWithStatus } from '../../../bindings';
import { approveToolCall, rejectToolCall } from '../../../lib/ai/tools';

// =============================================================================
// Types
// =============================================================================

export interface ToolApprovalDialogProps {
	toolCall: ToolCallWithStatus;
	onApproved?: (toolCallId: string) => void;
	onRejected?: (toolCallId: string) => void;
	className?: string;
}

// =============================================================================
// Helpers
// =============================================================================

const getToolIcon = (toolName: string) => {
	if (toolName.includes('bash') || toolName.includes('terminal')) {
		return Terminal;
	}
	if (toolName.includes('read') || toolName.includes('write') || toolName.includes('file')) {
		return FileText;
	}
	if (toolName.includes('dir') || toolName.includes('folder') || toolName.includes('list')) {
		return Folder;
	}
	if (toolName.includes('git')) {
		return GitBranch;
	}
	if (toolName.includes('grep') || toolName.includes('search') || toolName.includes('glob')) {
		return MagnifyingGlass;
	}
	return Terminal;
};

const formatToolName = (name: string): string => {
	return name
		.replace(/_/g, ' ')
		.replace(/\b\w/g, (c) => c.toUpperCase());
};

const formatArguments = (argsJson: string): Record<string, unknown> => {
	try {
		return JSON.parse(argsJson);
	} catch {
		return { raw: argsJson };
	}
};

// =============================================================================
// Component
// =============================================================================

export const ToolApprovalDialog: FC<ToolApprovalDialogProps> = ({
	toolCall,
	onApproved,
	onRejected,
	className = '',
}) => {
	const [isExpanded, setIsExpanded] = useState(true);
	const [isLoading, setIsLoading] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const prefersReduced = useReducedMotion();

	const Icon = getToolIcon(toolCall.tool_call.name);
	const args = useMemo(() => formatArguments(toolCall.tool_call.arguments), [toolCall.tool_call.arguments]);

	const handleApprove = useCallback(async () => {
		if (isLoading) return;
		setIsLoading(true);
		try {
			await approveToolCall(toolCall.tool_call.id);
			onApproved?.(toolCall.tool_call.id);
		} catch (error) {
			console.error('Failed to approve tool call:', error);
		} finally {
			setIsLoading(false);
		}
	}, [isLoading, toolCall.tool_call.id, onApproved]);

	const handleReject = useCallback(async () => {
		if (isLoading) return;
		setIsLoading(true);
		try {
			await rejectToolCall(toolCall.tool_call.id);
			onRejected?.(toolCall.tool_call.id);
		} catch (error) {
			console.error('Failed to reject tool call:', error);
		} finally {
			setIsLoading(false);
		}
	}, [isLoading, toolCall.tool_call.id, onRejected]);

	// Keyboard shortcuts
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			// Don't capture if user is typing in an input/textarea
			const target = e.target as HTMLElement;
			if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
				return;
			}

			if (e.key === 'y' || e.key === 'Enter') {
				e.preventDefault();
				handleApprove();
			} else if (e.key === 'n' || e.key === 'Escape') {
				e.preventDefault();
				handleReject();
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [handleApprove, handleReject]);

	const motionProps = prefersReduced
		? {}
		: {
			initial: { opacity: 0, y: 6, scale: 0.98 } as const,
			animate: { opacity: 1, y: 0, scale: 1 } as const,
			transition: { duration: 0.25, ease: [0.34, 1.56, 0.64, 1] as const },
		};

	return (
		<motion.div
			ref={containerRef}
			{...motionProps}
			className={`rounded-[12px] bg-card/95 backdrop-blur-sm shadow-[0_4px_24px_-6px_rgba(245,158,11,0.15)] dark:shadow-[0_4px_24px_-6px_rgba(245,158,11,0.1)] overflow-hidden ${className}`}
		>
			{/* Header */}
			<div className="p-3 space-y-3">
				{/* Warning Banner */}
				<div className="flex items-center gap-2 text-amber-600 dark:text-amber-500">
					<Warning className="w-4 h-4 flex-shrink-0" />
					<span className="text-sm font-medium">Tool requires approval</span>
				</div>

				{/* Tool Info */}
				<div className="flex items-start gap-3">
					<div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
						<Icon className="w-4 h-4 text-amber-600 dark:text-amber-500" />
					</div>
					<div className="flex-1 min-w-0">
						<div className="font-medium text-sm text-foreground">
							{formatToolName(toolCall.tool_call.name)}
						</div>
						<div className="text-xs text-muted-foreground mt-0.5">
							ID: <code className="font-mono">{toolCall.tool_call.id.slice(0, 8)}...</code>
						</div>
					</div>
				</div>

				{/* Parameters Toggle */}
				<button
					onClick={() => setIsExpanded(!isExpanded)}
					className="w-full flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors duration-150"
				>
					{isExpanded ? (
						<CaretDown className="w-3 h-3" />
					) : (
						<CaretRight className="w-3 h-3" />
					)}
					<span>Parameters</span>
				</button>

				{/* Parameters Content */}
				{isExpanded && (
					<div className="bg-muted/40 rounded-[10px] p-3 space-y-2">
						{Object.entries(args).map(([key, value]) => (
							<div key={key} className="text-xs">
								<span className="font-medium text-muted-foreground">{key}:</span>{' '}
								<code className="font-mono text-foreground break-all">
									{typeof value === 'string' ? value : JSON.stringify(value)}
								</code>
							</div>
						))}
					</div>
				)}

				{/* Actions */}
				<div className="flex items-center gap-2 pt-1">
					<button
						onClick={handleApprove}
						disabled={isLoading}
						className="flex-1 inline-flex items-center justify-center gap-2 h-[34px] px-4 text-sm font-medium rounded-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 hover:scale-[1.02] active:scale-[0.97] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
					>
						<Check className="w-4 h-4" />
						<span>Approve</span>
						<kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-500/10 text-[10px] font-mono text-emerald-500/70 ml-1">y</kbd>
					</button>
					<button
						onClick={handleReject}
						disabled={isLoading}
						className="flex-1 inline-flex items-center justify-center gap-2 h-[34px] px-4 text-sm font-medium rounded-[10px] bg-transparent text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:scale-[1.02] active:scale-[0.97] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
					>
						<X className="w-4 h-4" />
						<span>Reject</span>
						<kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded bg-muted/60 text-[10px] font-mono text-muted-foreground/70 ml-1">n</kbd>
					</button>
				</div>
			</div>
		</motion.div>
	);
};

// =============================================================================
// Inline Tool Approval (for message feed)
// =============================================================================

export interface ToolApprovalInlineProps {
	toolCall: ToolCallWithStatus;
	onApproved?: (toolCallId: string) => void;
	onRejected?: (toolCallId: string) => void;
	compact?: boolean;
}

export const ToolApprovalInline: FC<ToolApprovalInlineProps> = ({
	toolCall,
	onApproved,
	onRejected,
	compact = false,
}) => {
	const [isLoading, setIsLoading] = useState(false);
	const prefersReduced = useReducedMotion();
	const Icon = getToolIcon(toolCall.tool_call.name);
	const args = useMemo(() => formatArguments(toolCall.tool_call.arguments), [toolCall.tool_call.arguments]);

	const handleApprove = useCallback(async () => {
		if (isLoading) return;
		setIsLoading(true);
		try {
			await approveToolCall(toolCall.tool_call.id);
			onApproved?.(toolCall.tool_call.id);
		} catch (error) {
			console.error('Failed to approve tool call:', error);
		} finally {
			setIsLoading(false);
		}
	}, [isLoading, toolCall.tool_call.id, onApproved]);

	const handleReject = useCallback(async () => {
		if (isLoading) return;
		setIsLoading(true);
		try {
			await rejectToolCall(toolCall.tool_call.id);
			onRejected?.(toolCall.tool_call.id);
		} catch (error) {
			console.error('Failed to reject tool call:', error);
		} finally {
			setIsLoading(false);
		}
	}, [isLoading, toolCall.tool_call.id, onRejected]);

	// Keyboard shortcuts for inline approval
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
				return;
			}

			if (e.key === 'y' || e.key === 'Enter') {
				e.preventDefault();
				handleApprove();
			} else if (e.key === 'n' || e.key === 'Escape') {
				e.preventDefault();
				handleReject();
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [handleApprove, handleReject]);

	const motionProps = prefersReduced
		? {}
		: {
			initial: { opacity: 0, y: 4 } as const,
			animate: { opacity: 1, y: 0 } as const,
			transition: { duration: 0.2, ease: [0.34, 1.56, 0.64, 1] as const },
		};

	if (compact) {
		return (
			<motion.div
				{...motionProps}
				className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-[10px] bg-card/95 shadow-[0_2px_12px_-4px_rgba(245,158,11,0.12)]"
			>
				<Icon className="w-3 h-3 text-amber-600 dark:text-amber-500" />
				<span className="text-xs font-medium text-foreground">
					{formatToolName(toolCall.tool_call.name)}
				</span>
				<div className="flex items-center gap-1">
					<button
						onClick={handleApprove}
						disabled={isLoading}
						className="p-1 rounded-md hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 active:scale-95 transition-all duration-150 disabled:opacity-50"
						title="Approve (y)"
					>
						<Check className="w-3 h-3" />
					</button>
					<button
						onClick={handleReject}
						disabled={isLoading}
						className="p-1 rounded-md hover:bg-red-500/20 text-red-600 dark:text-red-400 active:scale-95 transition-all duration-150 disabled:opacity-50"
						title="Reject (n)"
					>
						<X className="w-3 h-3" />
					</button>
				</div>
			</motion.div>
		);
	}

	return (
		<motion.div
			{...motionProps}
			className="rounded-[12px] bg-card/95 backdrop-blur-sm shadow-[0_2px_16px_-4px_rgba(245,158,11,0.12)] dark:shadow-[0_2px_16px_-4px_rgba(245,158,11,0.08)] p-3 space-y-2"
		>
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<div className="w-6 h-6 rounded-md bg-amber-500/10 flex items-center justify-center">
						<Icon className="w-3.5 h-3.5 text-amber-600 dark:text-amber-500" />
					</div>
					<span className="text-sm font-medium">{formatToolName(toolCall.tool_call.name)}</span>
				</div>
				<div className="flex items-center gap-1">
					<button
						onClick={handleApprove}
						disabled={isLoading}
						className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-[8px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 hover:scale-[1.02] active:scale-[0.97] transition-all duration-150 disabled:opacity-50"
					>
						<Check className="w-3 h-3" />
						<span>Allow</span>
					</button>
					<button
						onClick={handleReject}
						disabled={isLoading}
						className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-[8px] bg-transparent text-muted-foreground hover:bg-red-500/10 hover:text-red-500 hover:scale-[1.02] active:scale-[0.97] transition-all duration-150 disabled:opacity-50"
					>
						<X className="w-3 h-3" />
						<span>Deny</span>
					</button>
				</div>
			</div>
			<div className="text-xs text-muted-foreground font-mono">
				{Object.entries(args)
					.slice(0, 2)
					.map(([key, value]) => (
						<div key={key} className="truncate">
							{key}: {typeof value === 'string' ? value : JSON.stringify(value)}
						</div>
					))}
				{Object.keys(args).length > 2 && (
					<div className="text-muted-foreground/60">
						+{Object.keys(args).length - 2} more...
					</div>
				)}
			</div>
		</motion.div>
	);
};
