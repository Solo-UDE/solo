/**
 * Visual timeline showing tool call durations as horizontal bars.
 */

import { useMemo, type FC } from 'react';
import { Timer } from '@phosphor-icons/react';
import { useDebugStore, type ToolTimelineEntry } from '../../../stores/debugStore';

const STATUS_COLORS: Record<string, string> = {
	running: 'bg-info/60',
	success: 'bg-success/60',
	error: 'bg-destructive/60',
};

const STATUS_TEXT: Record<string, string> = {
	running: 'text-info',
	success: 'text-success',
	error: 'text-destructive',
};

const ToolBar: FC<{ entry: ToolTimelineEntry; maxDuration: number }> = ({ entry, maxDuration }) => {
	const widthPercent = entry.durationMs && maxDuration > 0
		? Math.max(5, (entry.durationMs / maxDuration) * 100)
		: entry.status === 'running' ? 100 : 5;

	return (
		<div className="flex items-center gap-2 px-2 py-1 hover:bg-muted/30 text-xs">
			<span className="text-foreground/80 font-mono w-28 truncate shrink-0" title={entry.toolName}>
				{entry.toolName}
			</span>
			<div className="flex-1 h-4 bg-muted/20 rounded overflow-hidden">
				<div
					className={`h-full rounded transition-all duration-200 ${STATUS_COLORS[entry.status] ?? 'bg-muted/40'} ${entry.status === 'running' ? 'animate-pulse' : ''}`}
					style={{ width: `${widthPercent}%` }}
				/>
			</div>
			<span className={`w-16 text-right shrink-0 font-mono ${STATUS_TEXT[entry.status] ?? 'text-muted-foreground'}`}>
				{entry.durationMs != null ? `${entry.durationMs}ms` : entry.status === 'running' ? '...' : '--'}
			</span>
		</div>
	);
};

export const ToolTimeline: FC = () => {
	const timeline = useDebugStore((s) => s.toolTimeline);

	const maxDuration = useMemo(
		() => Math.max(1, ...timeline.map((t) => t.durationMs ?? 0)),
		[timeline]
	);

	// Show newest first
	const reversed = useMemo(() => [...timeline].reverse(), [timeline]);

	return (
		<div className="flex flex-col h-full">
			<div className="flex items-center justify-between px-2 py-1 border-b border-border/30">
				<span className="text-xs text-muted-foreground">
					{timeline.length} tool calls
				</span>
			</div>
			<div className="flex-1 overflow-y-auto">
				{reversed.map((entry, i) => (
					<ToolBar key={`${entry.toolId}-${i}`} entry={entry} maxDuration={maxDuration} />
				))}
				{reversed.length === 0 && (
					<div className="flex flex-col items-center justify-center h-20 gap-1">
						<Timer className="w-4 h-4 text-muted-foreground/30" />
						<span className="text-xs text-muted-foreground/50">No tool calls yet</span>
					</div>
				)}
			</div>
		</div>
	);
};
