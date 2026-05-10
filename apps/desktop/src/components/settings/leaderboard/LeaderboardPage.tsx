/**
 * Full leaderboard — top 100 global, with tier filter and sticky "your rank"
 * callout if the current user is outside the visible top-N.
 */

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ReloadIcon } from '@radix-ui/react-icons';
import { TIER_META, type TierIndex } from '@solo/tier-names';
import { useTierStats } from '../../../hooks/useTierStats';
import { useCloudStatsStore } from '../../../stores/cloudStatsStore';
import { VirtualList } from '../../ui/virtual-list';

const TIER_FILTERS: Array<'all' | TierIndex> = ['all', 7, 6, 5, 4, 3, 2, 1];

export function LeaderboardPage() {
	const stats = useTierStats();
	const leaderboard = useCloudStatsStore((s) => s.leaderboard);
	const isLoading = useCloudStatsStore((s) => s.isLoadingLeaderboard);
	const loadLeaderboard = useCloudStatsStore((s) => s.loadLeaderboard);
	const error = useCloudStatsStore((s) => s.error);
	const [filter, setFilter] = useState<'all' | TierIndex>('all');

	useEffect(() => {
		void loadLeaderboard(100);
	}, [loadLeaderboard]);

	const filtered = useMemo(() => {
		if (filter === 'all') return leaderboard;
		return leaderboard.filter((e) => e.tier === filter);
	}, [leaderboard, filter]);

	const myEntry = useMemo(() => {
		if (!stats.cumulative) return null;
		// Match on score proximity — the server and client compute tiers
		// identically, so equality is fine in normal cases.
		return leaderboard.find(
			(entry) =>
				entry.tier === stats.tier &&
				Math.abs(entry.score - stats.score) < 0.001
		);
	}, [leaderboard, stats.tier, stats.score]);

	const myRank = myEntry
		? leaderboard.findIndex((e) => e.userId === myEntry.userId) + 1
		: null;
	const myInVisible =
		myRank !== null && filtered.some((e) => e.userId === myEntry?.userId);

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between">
				<div className="flex flex-wrap gap-1.5">
					{TIER_FILTERS.map((f) => {
						const isActive = filter === f;
						const label =
							f === 'all'
								? 'All tiers'
								: `${TIER_META[f].emoji} ${TIER_META[f].name}`;
						return (
							<button
								key={String(f)}
								type="button"
								onClick={() => setFilter(f)}
								className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
									isActive
										? 'border-primary/70 bg-primary/10 text-foreground'
										: 'border-border/60 text-muted-foreground hover:border-border hover:text-foreground'
								}`}
							>
								{label}
							</button>
						);
					})}
				</div>
				<button
					type="button"
					onClick={() => void loadLeaderboard(100)}
					disabled={isLoading}
					className="flex items-center gap-1.5 rounded-[8px] border border-border/60 bg-background/70 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
				>
					<ReloadIcon className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
					Refresh
				</button>
			</div>

			{myRank !== null && !myInVisible ? (
				<motion.div
					initial={{ opacity: 0, y: -4 }}
					animate={{ opacity: 1, y: 0 }}
					className="sticky top-0 z-10 rounded-[10px] border border-primary/50 bg-background/95 px-3 py-2 text-sm backdrop-blur"
				>
					You&apos;re ranked #{myRank} · T{stats.tier} ·{' '}
					{Math.round(stats.score * 100)} pts
				</motion.div>
			) : null}

			{error ? <p className="text-xs text-destructive">{error}</p> : null}

			{isLoading && leaderboard.length === 0 ? (
				<p className="text-sm text-muted-foreground">Loading leaderboard…</p>
			) : filtered.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No climbers at this tier yet.
				</p>
			) : (
				<VirtualList
					items={filtered}
					estimateSize={() => 62}
					overscan={10}
					role="list"
					className="max-h-[620px] rounded-[10px] border border-border/60 bg-background/55"
					itemClassName="border-b border-border/50 last:border-b-0"
					getItemKey={(entry) => entry.userId}
					testId="leaderboard-entries"
					renderItem={(entry, idx) => {
						const globalRank =
							leaderboard.findIndex((e) => e.userId === entry.userId) + 1;
						const isMe = myEntry?.userId === entry.userId;
						const meta = TIER_META[entry.tier as TierIndex] ?? TIER_META[1];
						return (
							<div
								role="listitem"
								className={`flex items-center justify-between px-4 py-2.5 text-sm ${
									isMe ? 'bg-primary/5' : 'hover:bg-background/80'
								}`}
							>
								<div className="flex min-w-0 items-center gap-4">
									<span className="w-8 text-right text-xs text-muted-foreground">
										#{globalRank || idx + 1}
									</span>
									<span className="text-base leading-none">{meta.emoji}</span>
									<div className="min-w-0">
										<p
											className={`truncate ${
												isMe ? 'font-semibold text-foreground' : 'text-foreground'
											}`}
										>
											{entry.githubUsername ?? entry.userId.slice(0, 10)}
											{isMe ? ' · you' : ''}
										</p>
										<p className="text-[11px] text-muted-foreground">
											T{entry.tier} · {meta.name}
										</p>
									</div>
								</div>
								<div className="shrink-0 text-right">
									<p className="text-sm font-medium text-foreground">
										{Math.round(entry.score * 100)} pts
									</p>
									<p className="text-[11px] text-muted-foreground">
										{new Intl.NumberFormat(undefined, {
											notation: 'compact',
											maximumFractionDigits: 1,
										}).format(Number(entry.commits))}{' '}
										commits
									</p>
								</div>
							</div>
						);
					}}
				/>
			)}
		</div>
	);
}
