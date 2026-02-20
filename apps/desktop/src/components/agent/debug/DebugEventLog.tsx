/**
 * Filterable debug event log — shows all bridge events with category badges.
 */

import { useMemo, type FC } from 'react';
import { useDebugStore, type DebugEventEntry } from '../../../stores/debugStore';

const CATEGORY_COLORS: Record<string, string> = {
	streaming: 'bg-blue-500/20 text-blue-400',
	tool: 'bg-amber-500/20 text-amber-400',
	token: 'bg-emerald-500/20 text-emerald-400',
	sdk_state: 'bg-purple-500/20 text-purple-400',
	permission: 'bg-rose-500/20 text-rose-400',
	session: 'bg-cyan-500/20 text-cyan-400',
	hook: 'bg-orange-500/20 text-orange-400',
	compaction: 'bg-violet-500/20 text-violet-400',
	subagent: 'bg-teal-500/20 text-teal-400',
};

const CategoryBadge: FC<{ category: string }> = ({ category }) => (
	<span className={`px-1.5 py-0.5 rounded text-[10px] font-mono uppercase ${CATEGORY_COLORS[category] ?? 'bg-muted text-muted-foreground'}`}>
		{category}
	</span>
);

const EventRow: FC<{ event: DebugEventEntry }> = ({ event }) => {
	const time = new Date(event.timestamp).toLocaleTimeString('en-US', {
		hour12: false,
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	});

	return (
		<div className="flex items-start gap-2 px-2 py-1 hover:bg-muted/30 text-xs font-mono border-b border-border/20 last:border-b-0">
			<span className="text-muted-foreground/60 shrink-0 w-16">{time}</span>
			<CategoryBadge category={event.category} />
			<span className="text-foreground/90 truncate flex-1">{event.name}</span>
			{event.durationMs != null && (
				<span className="text-muted-foreground/50 shrink-0">{event.durationMs}ms</span>
			)}
			{event.correlationId && (
				<span className="text-muted-foreground/40 shrink-0 w-16 truncate" title={event.correlationId}>
					{event.correlationId.slice(0, 8)}
				</span>
			)}
		</div>
	);
};

export const DebugEventLog: FC = () => {
	const events = useDebugStore((s) => s.events);
	const filters = useDebugStore((s) => s.filters);
	const clearEvents = useDebugStore((s) => s.clearEvents);

	const filteredEvents = useMemo(() => {
		if (filters.size === 0) return events;
		return events.filter((e) => filters.has(e.category));
	}, [events, filters]);

	// Show newest first
	const reversed = useMemo(() => [...filteredEvents].reverse(), [filteredEvents]);

	return (
		<div className="flex flex-col h-full">
			<div className="flex items-center justify-between px-2 py-1 border-b border-border/30">
				<span className="text-xs text-muted-foreground">
					{filteredEvents.length} events{filters.size > 0 ? ' (filtered)' : ''}
				</span>
				<button
					onClick={clearEvents}
					className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
				>
					Clear
				</button>
			</div>
			<div className="flex-1 overflow-y-auto">
				{reversed.map((event) => (
					<EventRow key={event.id} event={event} />
				))}
				{reversed.length === 0 && (
					<div className="flex items-center justify-center h-20 text-xs text-muted-foreground/50">
						No events yet. Send a message to see debug events.
					</div>
				)}
			</div>
		</div>
	);
};
