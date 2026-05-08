/**
 * ToolCard — Codex-style base component for tool call visualization.
 *
 * Features:
 * - Flat receipt row with tool label and primary command/path preview
 * - Collapsible output via CSS grid-rows transition
 * - Status-aware icons: spinner (running), check (success), X (error), shield (permission)
 * - Truncated output with "show more" control
 * - Slot for specialized content via children prop
 */

import { CheckCircledIcon, CrossCircledIcon, ChevronRightIcon } from '@radix-ui/react-icons';
import { Loader2, ShieldAlert } from 'lucide-react';
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
			return <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin shrink-0" />;
		case 'success':
			return <CheckCircledIcon width={14} height={14} className="text-status-success shrink-0" />;
		case 'error':
			return <CrossCircledIcon width={14} height={14} className="text-status-error shrink-0" />;
		case 'awaiting-permission':
			return <ShieldAlert className="h-3.5 w-3.5 text-status-warning shrink-0" />;
	}
};

const defaultLabel = (toolName: string, status: ToolStatus): string => {
	const name = toolName
		.replace(/_/g, ' ')
		.replace(/\b\w/g, (c) => c.toUpperCase());
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
	const outputLineCount = output?.split('\n').filter(Boolean).length ?? 0;
	const outputLineCountLabel = `${outputLineCount} ${outputLineCount === 1 ? 'line' : 'lines'}`;

	const toggleExpanded = () => {
		if (canExpand) setIsExpanded(!isExpanded);
	};

	return (
		<div
			className={`group my-0.5 min-w-0 animate-in fade-in-0 duration-150 ${className}`}
			style={style}
		>
			{/* Single-line Codex-style receipt header: flat, compact, and expandable. */}
			<button
				type="button"
				onClick={toggleExpanded}
				className={`flex max-w-full items-center gap-1.5 rounded-md py-0.5 text-xs text-muted-foreground outline-none transition-[color,transform] duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/35 active:scale-[0.99] ${
					canExpand ? 'cursor-pointer' : 'cursor-default'
				}`}
				aria-expanded={isExpanded}
				aria-label={`${label ?? defaultLabel(toolName, status)}${primaryDisplay ? ` ${primaryDisplay}` : ''}`}
				disabled={!canExpand}
			>
				<span className="flex h-4 w-4 shrink-0 items-center justify-center">
					{icon ?? <StatusIcon status={status} />}
				</span>

				<span className="shrink-0 text-[13px] leading-5 text-foreground/86">
					{label ?? defaultLabel(toolName, status)}
				</span>

				{primaryDisplay ? (
					<code
						className="min-w-0 max-w-[min(42rem,66vw)] truncate font-mono text-[12px] leading-5 text-muted-foreground/62"
						title={primaryDisplay}
					>
						{primaryDisplay}
					</code>
				) : null}

				{outputLineCount > 0 ? (
					<span className="shrink-0 rounded-full bg-muted/40 px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground/70 tabular-nums">
						{outputLineCountLabel}
					</span>
				) : null}

				{canExpand ? (
					<ChevronRightIcon
						width={12} height={12}
						className={`shrink-0 text-muted-foreground/46 transition-transform duration-200 ${
							isExpanded ? 'rotate-90' : ''
						}`}
					/>
				) : null}
			</button>

			{/* Expanded content — quiet and indented under the receipt header. */}
			<ExpandRegion isExpanded={isExpanded}>
				{children ? (
					<div className="mt-1.5 ml-5 min-w-0">
						{children}
					</div>
				) : null}

				{status === 'running' && !output && !children ? (
					<div className="mt-1 ml-5 flex items-center gap-2 text-xs text-muted-foreground">
						<Loader2 className="h-3 w-3 animate-spin" />
						<span>Processing...</span>
					</div>
				) : displayOutput ? (
					<div className="mt-1.5 ml-5 min-w-0">
						<div className="relative font-mono text-xs tool-widget-output p-2.5 max-h-[320px] overflow-y-auto">
							<pre className="whitespace-pre-wrap break-words text-[12px] leading-5 text-foreground/84">
								{showAllOutput ? output : displayOutput}
							</pre>
							{isTruncated && !showAllOutput ? (
								<button
									type="button"
									onClick={(e) => { e.stopPropagation(); setShowAllOutput(true); }}
									className="mt-2 min-h-8 rounded-md px-1 text-[11px] text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
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
