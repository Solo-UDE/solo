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
	CaretRight,
} from '@phosphor-icons/react';
import { useState, useMemo } from 'react';

import { ExpandRegion } from '../messages/shared/ExpandRegion';

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
	readonly style?: React.CSSProperties;
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
	style,
}) => {
	// Codex parity: default collapsed. Caller can override with defaultExpanded.
	const resolvedDefault = defaultExpanded ?? false;
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

	const hasContent = !!(output || children);
	const canExpand = collapsible && hasContent;

	const toggleExpanded = () => {
		if (canExpand) setIsExpanded(!isExpanded);
	};

	return (
		<div
			className={`group my-0.5 animate-in fade-in-0 duration-150 ${className}`}
			style={style}
		>
			{/* Single-line Codex-style header — flat, no card chrome */}
			<button
				type="button"
				onClick={toggleExpanded}
				className={`flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-0.5 ${
					canExpand ? 'cursor-pointer' : 'cursor-default'
				}`}
				aria-expanded={isExpanded}
				disabled={!canExpand}
			>
				{icon ?? <StatusIcon status={status} />}

				<span className="text-foreground/85">
					{label ?? defaultLabel(toolName, status)}
				</span>

				{primaryDisplay ? (
					<code className="font-mono text-muted-foreground truncate max-w-[480px]">
						{primaryDisplay}
					</code>
				) : null}

				{canExpand ? (
					<CaretRight
						className={`h-3 w-3 text-muted-foreground/50 transition-transform duration-200 ${
							isExpanded ? 'rotate-90' : ''
						}`}
					/>
				) : null}
			</button>

			{/* Expanded content — subtle tinted block, no border, indented under header */}
			<ExpandRegion isExpanded={isExpanded}>
				{children ? (
					<div className="mt-1.5 ml-5">
						{children}
					</div>
				) : null}

				{status === 'running' && !output && !children ? (
					<div className="mt-1 ml-5 flex items-center gap-2 text-xs text-muted-foreground">
						<CircleNotch className="h-3 w-3 animate-spin" />
						<span>Processing...</span>
					</div>
				) : displayOutput ? (
					<div className="mt-1.5 ml-5">
						<div className="relative font-mono text-xs tool-widget-output p-2.5 max-h-[320px] overflow-y-auto">
							<pre className="whitespace-pre-wrap break-words text-foreground/85">
								{showAllOutput ? output : displayOutput}
							</pre>
							{isTruncated && !showAllOutput ? (
								<button
									type="button"
									onClick={(e) => { e.stopPropagation(); setShowAllOutput(true); }}
									className="mt-2 text-[11px] text-primary hover:text-primary/80 transition-colors"
								>
									Show all {totalLines} lines
								</button>
							) : null}
						</div>
					</div>
				) : null}
			</ExpandRegion>
		</div>
	);
};
