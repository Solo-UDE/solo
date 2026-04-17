/**
 * 4×2 grid of stat tiles. Large numerals, compact labels. Uses Intl for
 * locale-aware grouping on bigints (e.g. 21,000,000 instead of 21000000).
 */

import type { CumulativeStats } from '../../../bindings';

interface StatsGridProps {
	cumulative: CumulativeStats;
}

function formatBigInt(n: bigint): string {
	return new Intl.NumberFormat().format(n);
}

function formatCompact(n: bigint): string {
	const num = Number(n);
	if (!Number.isFinite(num)) return formatBigInt(n);
	return new Intl.NumberFormat(undefined, {
		notation: 'compact',
		maximumFractionDigits: 1,
	}).format(num);
}

interface Tile {
	label: string;
	value: string;
	hint?: string;
}

export function StatsGrid({ cumulative }: StatsGridProps) {
	const tiles: Tile[] = [
		{ label: 'Sessions', value: formatBigInt(cumulative.sessions) },
		{ label: 'Messages', value: formatBigInt(cumulative.messages) },
		{ label: 'Tokens', value: formatCompact(cumulative.tokens) },
		{ label: 'Commits', value: formatBigInt(cumulative.commits) },
		{ label: 'Worktrees', value: formatBigInt(cumulative.worktrees) },
		{
			label: 'Current streak',
			value: `${cumulative.streakCurrent}`,
			hint: cumulative.streakCurrent === 1 ? 'day' : 'days',
		},
		{
			label: 'Longest streak',
			value: `${cumulative.streakLongest}`,
			hint: cumulative.streakLongest === 1 ? 'day' : 'days',
		},
		{
			label: 'Last active',
			value: cumulative.lastActive
				? new Date(cumulative.lastActive).toLocaleDateString(undefined, {
						month: 'short',
						day: 'numeric',
					})
				: '—',
		},
	];

	return (
		<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
			{tiles.map((tile) => (
				<div
					key={tile.label}
					className="rounded-[10px] border border-border/60 bg-background/60 px-3 py-3"
				>
					<p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/65">
						{tile.label}
					</p>
					<p className="mt-1 text-xl font-semibold text-foreground">
						{tile.value}
						{tile.hint ? (
							<span className="ml-1 text-[11px] font-normal text-muted-foreground">
								{tile.hint}
							</span>
						) : null}
					</p>
				</div>
			))}
		</div>
	);
}
