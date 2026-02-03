/**
 * Tool Approval Dialog
 *
 * Displays pending tool calls that require user approval before execution.
 * Shows tool details, parameters, and allows approve/reject actions.
 */

import { FC, useState, useMemo } from 'react';
import {
	AlertTriangle,
	Check,
	X,
	ChevronDown,
	ChevronRight,
	Terminal,
	FileText,
	Folder,
	Search,
	GitBranch,
} from 'lucide-react';
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
		return Search;
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

	const Icon = getToolIcon(toolCall.tool_call.name);
	const args = useMemo(() => formatArguments(toolCall.tool_call.arguments), [toolCall.tool_call.arguments]);

	const handleApprove = async () => {
		setIsLoading(true);
		try {
			await approveToolCall(toolCall.tool_call.id);
			onApproved?.(toolCall.tool_call.id);
		} catch (error) {
			console.error('Failed to approve tool call:', error);
		} finally {
			setIsLoading(false);
		}
	};

	const handleReject = async () => {
		setIsLoading(true);
		try {
			await rejectToolCall(toolCall.tool_call.id);
			onRejected?.(toolCall.tool_call.id);
		} catch (error) {
			console.error('Failed to reject tool call:', error);
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div
			className={`border border-amber-500/30 rounded-lg bg-amber-500/5 overflow-hidden ${className}`}
		>
			{/* Header */}
			<div className="p-3 space-y-3">
				{/* Warning Banner */}
				<div className="flex items-center gap-2 text-amber-600 dark:text-amber-500">
					<AlertTriangle className="w-4 h-4 flex-shrink-0" />
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
					className="w-full flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
				>
					{isExpanded ? (
						<ChevronDown className="w-3 h-3" />
					) : (
						<ChevronRight className="w-3 h-3" />
					)}
					<span>Parameters</span>
				</button>

				{/* Parameters Content */}
				{isExpanded && (
					<div className="bg-muted/50 rounded-md p-3 space-y-2">
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
						className="flex-1 inline-flex items-center justify-center gap-2 h-9 px-4 text-sm font-medium rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
					>
						<Check className="w-4 h-4" />
						<span>Approve</span>
					</button>
					<button
						onClick={handleReject}
						disabled={isLoading}
						className="flex-1 inline-flex items-center justify-center gap-2 h-9 px-4 text-sm font-medium rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
					>
						<X className="w-4 h-4" />
						<span>Reject</span>
					</button>
				</div>
			</div>
		</div>
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
	const Icon = getToolIcon(toolCall.tool_call.name);
	const args = useMemo(() => formatArguments(toolCall.tool_call.arguments), [toolCall.tool_call.arguments]);

	const handleApprove = async () => {
		setIsLoading(true);
		try {
			await approveToolCall(toolCall.tool_call.id);
			onApproved?.(toolCall.tool_call.id);
		} catch (error) {
			console.error('Failed to approve tool call:', error);
		} finally {
			setIsLoading(false);
		}
	};

	const handleReject = async () => {
		setIsLoading(true);
		try {
			await rejectToolCall(toolCall.tool_call.id);
			onRejected?.(toolCall.tool_call.id);
		} catch (error) {
			console.error('Failed to reject tool call:', error);
		} finally {
			setIsLoading(false);
		}
	};

	if (compact) {
		return (
			<div className="inline-flex items-center gap-2 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/20">
				<Icon className="w-3 h-3 text-amber-600 dark:text-amber-500" />
				<span className="text-xs font-medium text-foreground">
					{formatToolName(toolCall.tool_call.name)}
				</span>
				<div className="flex items-center gap-1">
					<button
						onClick={handleApprove}
						disabled={isLoading}
						className="p-1 rounded hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 disabled:opacity-50"
						title="Approve"
					>
						<Check className="w-3 h-3" />
					</button>
					<button
						onClick={handleReject}
						disabled={isLoading}
						className="p-1 rounded hover:bg-red-500/20 text-red-600 dark:text-red-400 disabled:opacity-50"
						title="Reject"
					>
						<X className="w-3 h-3" />
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="border border-amber-500/20 rounded-lg bg-amber-500/5 p-3 space-y-2">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Icon className="w-4 h-4 text-amber-600 dark:text-amber-500" />
					<span className="text-sm font-medium">{formatToolName(toolCall.tool_call.name)}</span>
				</div>
				<div className="flex items-center gap-1">
					<button
						onClick={handleApprove}
						disabled={isLoading}
						className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50"
					>
						<Check className="w-3 h-3" />
						<span>Allow</span>
					</button>
					<button
						onClick={handleReject}
						disabled={isLoading}
						className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 disabled:opacity-50"
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
		</div>
	);
};
