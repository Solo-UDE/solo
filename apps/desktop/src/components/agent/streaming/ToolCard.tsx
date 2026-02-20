/**
 * ToolCard — Glass-morphism base component for tool call visualization.
 *
 * Features:
 * - Frosted glass container with subtle border and shadow
 * - Collapsible output via CSS grid-rows transition (0fr → 1fr)
 * - Status-aware icons: spinner (running), check (success), X (error), shield (permission)
 * - Truncated output with "show more" fade gradient
 * - Slot for specialized content via children prop
 */

import {
	CircleNotch,
	CheckCircle,
	XCircle,
	ShieldWarning,
	CaretDown,
} from '@phosphor-icons/react';
import { useState, useMemo } from 'react';

import type { FC, ReactNode } from 'react';

export type ToolStatus = 'running' | 'success' | 'error' | 'awaiting-permission';

export interface ToolCardProps {
	readonly toolName: string;
	readonly status: ToolStatus;
	readonly icon?: ReactNode;
	/** Override default "Running X" / "Ran X" label */
	readonly label?: string;
	/** Primary display string — command, file path, pattern, etc. */
	readonly primaryDisplay?: string;
	readonly output?: string;
	/** Max lines before truncation (default 10) */
	readonly maxOutputLines?: number;
	readonly children?: ReactNode;
	/** Enable collapse/expand (default true) */
	readonly collapsible?: boolean;
	/** Start expanded (default: true for running/success, false otherwise) */
	readonly defaultExpanded?: boolean;
	readonly className?: string;
}

const StatusIcon: FC<{ status: ToolStatus }> = ({ status }) => {
	switch (status) {
		case 'running':
			return <CircleNotch className="h-3.5 w-3.5 text-muted-foreground animate-spin shrink-0" />;
		case 'success':
			return <CheckCircle className="h-3.5 w-3.5 text-status-success shrink-0" weight="fill" />;
		case 'error':
			return <XCircle className="h-3.5 w-3.5 text-status-error shrink-0" weight="fill" />;
		case 'awaiting-permission':
			return <ShieldWarning className="h-3.5 w-3.5 text-status-warning shrink-0" weight="fill" />;
	}
};

const defaultLabel = (toolName: string, status: ToolStatus): string => {
	const name = toolName.charAt(0).toUpperCase() + toolName.slice(1);
	switch (status) {
		case 'running': return `Running ${name}`;
		case 'success': return `Ran ${name}`;
		case 'error': return `${name} failed`;
		case 'awaiting-permission': return `${name} — Permission Required`;
	}
};

export const ToolCard: FC<ToolCardProps> = ({
	toolName,
	status,
	icon,
	label,
	primaryDisplay,
	output,
	maxOutputLines = 10,
	children,
	collapsible = true,
	defaultExpanded,
	className = '',
}) => {
	const resolvedDefault = defaultExpanded ?? (status === 'running' || status === 'success');
	const [isExpanded, setIsExpanded] = useState(resolvedDefault);

	const { displayOutput, isTruncated, totalLines } = useMemo(() => {
		if (!output) return { displayOutput: undefined, isTruncated: false, totalLines: 0 };
		const lines = output.split('\n');
		const total = lines.length;
		if (total <= maxOutputLines) return { displayOutput: output, isTruncated: false, totalLines: total };
		return {
			displayOutput: lines.slice(0, maxOutputLines).join('\n'),
			isTruncated: true,
			totalLines: total,
		};
	}, [output, maxOutputLines]);

	const [showAllOutput, setShowAllOutput] = useState(false);

	const toggleExpanded = () => {
		if (collapsible) setIsExpanded(!isExpanded);
	};

	return (
		<div
			className={`my-2 rounded-xl bg-card/60 backdrop-blur-sm border border-border/20 shadow-sm overflow-hidden transition-shadow duration-200 hover:shadow-md ${className}`}
		>
			{/* Header */}
			<button
				onClick={toggleExpanded}
				className={`w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors ${
					collapsible ? 'cursor-pointer' : 'cursor-default'
				}`}
				aria-expanded={isExpanded}
			>
				{/* Tool icon or status icon */}
				{icon ?? <StatusIcon status={status} />}

				{/* Label */}
				<span className="text-xs font-medium text-foreground">
					{label ?? defaultLabel(toolName, status)}
				</span>

				{/* Status indicator for running */}
				{status === 'running' && !icon ? (
					<CircleNotch className="h-3 w-3 animate-spin text-muted-foreground" />
				) : null}

				{/* Primary display */}
				{primaryDisplay ? (
					<code className="text-xs font-mono text-muted-foreground truncate max-w-[300px]">
						{primaryDisplay}
					</code>
				) : null}

				{/* Spacer */}
				<div className="flex-1" />

				{/* Collapse indicator */}
				{collapsible ? (
					<CaretDown
						className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${
							isExpanded ? 'rotate-0' : '-rotate-90'
						}`}
					/>
				) : null}
			</button>

			{/* Collapsible content — CSS grid-rows transition */}
			<div
				className="grid transition-[grid-template-rows] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
				style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
			>
				<div className="overflow-hidden min-h-0">
					{/* Custom children slot */}
					{children ? (
						<div className="px-3 pb-2">
							{children}
						</div>
					) : null}

					{/* Output section */}
					{status === 'running' && !output && !children ? (
						<div className="flex items-center gap-2 px-3 pb-3 text-xs text-muted-foreground">
							<CircleNotch className="h-3 w-3 animate-spin" />
							<span>Processing...</span>
						</div>
					) : displayOutput ? (
						<div className="px-3 pb-3">
							<div className="relative font-mono text-xs bg-muted/30 rounded-lg p-3 max-h-[300px] overflow-y-auto">
								<pre className="whitespace-pre-wrap break-words text-foreground/80">
									{showAllOutput ? output : displayOutput}
								</pre>
								{/* Truncation fade + "show more" */}
								{isTruncated && !showAllOutput ? (
									<div className="sticky bottom-0 left-0 right-0">
										<div className="h-8 bg-gradient-to-t from-muted/30 to-transparent" />
										<button
											onClick={(e) => { e.stopPropagation(); setShowAllOutput(true); }}
											className="text-xs text-primary hover:text-primary/80 transition-colors"
										>
											Show all {totalLines} lines
										</button>
									</div>
								) : null}
							</div>
						</div>
					) : !children && status !== 'running' ? (
						<div className="px-3 pb-3 text-xs text-muted-foreground italic">
							No output
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
};
