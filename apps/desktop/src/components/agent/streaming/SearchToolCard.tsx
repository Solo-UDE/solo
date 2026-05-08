/**
 * SearchToolCard — Specialized tool card for Glob/Grep search operations.
 *
 * Shows magnifying glass icon, search pattern display,
 * match/file count badge, and results list.
 */

import { MagnifyingGlassIcon } from '@radix-ui/react-icons';
import { AnimatedList } from '@/components/ui/animated-list';

import { ToolCard } from './ToolCard';

import type { FC } from 'react';
import type { ToolStatus } from './ToolCard';

export interface SearchToolCardProps {
	readonly toolName: 'Glob' | 'Grep' | string;
	readonly pattern: string;
	readonly path?: string;
	readonly output?: string;
	readonly status: ToolStatus;
	/** Extra qualifiers like outputMode, glob filter, fileType */
	readonly outputMode?: string;
	readonly glob?: string;
	readonly fileType?: string;
	readonly style?: React.CSSProperties;
}

export const SearchToolCard: FC<SearchToolCardProps> = ({
	toolName,
	pattern,
	path,
	output,
	status,
	outputMode,
	glob,
	fileType,
	style,
}) => {
	const results = output?.split('\n').filter(Boolean) ?? [];
	const resultCount = results.length;
	const isGlob = toolName.toLowerCase() === 'glob';

	// Build qualifier badges
	const badges: string[] = [];
	if (path) badges.push(path);
	if (glob) badges.push(`glob:${glob}`);
	if (fileType) badges.push(`type:${fileType}`);
	if (outputMode) badges.push(outputMode);

	return (
		<ToolCard
			toolName={toolName}
			status={status}
			icon={<MagnifyingGlassIcon width={14} height={14} className="shrink-0 text-muted-foreground" />}
			label={status === 'running' ? 'Searching' : `Ran ${isGlob ? 'Glob' : 'Grep'}`}
			primaryDisplay={pattern}
			collapsible={resultCount > 0}
			defaultExpanded={false}
			style={style}
		>
			<div className="space-y-2">
				{/* Qualifier badges */}
				{badges.length > 0 ? (
					<div className="flex flex-wrap gap-1">
						{badges.map((badge) => (
							<span
								key={badge}
								className="rounded-md bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
							>
								{badge}
							</span>
						))}
					</div>
				) : null}

				{/* Result count */}
				{resultCount > 0 ? (
					<div className="flex items-center gap-1.5">
						<span className="rounded-full bg-muted/50 px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
							{resultCount} {isGlob ? 'files' : 'matches'}
						</span>
					</div>
				) : null}

				{/* Results preview (first 8 files) */}
				{resultCount > 0 ? (
					<div className="max-h-[160px] overflow-y-auto rounded-lg bg-muted/20 p-2">
						<AnimatedList stagger={0.02} slideY={3}>
							{results.slice(0, 8).map((result, i) => (
								<div key={`r-${String(i)}`} className="truncate px-1 py-0.5 font-mono text-xs text-foreground/80">
									{result}
								</div>
							))}
						</AnimatedList>
						{resultCount > 8 ? (
							<div className="text-xs text-muted-foreground pt-1 px-1">
								...and {resultCount - 8} more
							</div>
						) : null}
					</div>
				) : null}
			</div>
		</ToolCard>
	);
};
