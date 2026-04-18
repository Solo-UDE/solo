/**
 * Cinematic Journey page. First settings tab.
 *
 * Layout (top → bottom):
 *   1. Identity banner — tier emoji + name + current progress
 *   2. Tier ladder — 7 emojis with progress bar
 *   3. Stats grid — 8 tiles with cumulative + streaks
 *   4. Leaderboard preview — top 10 with rank highlight
 *   5. Action bar — [Sync now] [Share card]
 */

import { useEffect } from 'react';
import { motion } from 'motion/react';
import { ReloadIcon, Share1Icon } from '@radix-ui/react-icons';
import { useTierStats } from '../../../hooks/useTierStats';
import { useCloudStatsStore } from '../../../stores/cloudStatsStore';
import { TierLadder } from './TierLadder';
import { StatsGrid } from './StatsGrid';
import { ContributionGraph } from './ContributionGraph';

export function JourneyPage() {
	const stats = useTierStats();
	const loadLeaderboard = useCloudStatsStore((s) => s.loadLeaderboard);
	const leaderboard = useCloudStatsStore((s) => s.leaderboard);
	const isLoadingLeaderboard = useCloudStatsStore((s) => s.isLoadingLeaderboard);
	const generateCard = useCloudStatsStore((s) => s.generateCard);

	useEffect(() => {
		void stats.initialize();
	}, [stats]);

	useEffect(() => {
		if (leaderboard.length === 0) {
			void loadLeaderboard(10);
		}
	}, [leaderboard.length, loadLeaderboard]);

	const handleShare = async () => {
		try {
			const url = await generateCard();
			window.open(url, '_blank');
		} catch (err) {
			console.error('Share card failed:', err);
		}
	};

	const progressPercent = Math.round(stats.tierProgress * 100);

	return (
		<div className="flex flex-col gap-6">
			{/* Identity banner */}
			<motion.div
				initial={{ opacity: 0, y: 6 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.4 }}
				className="relative overflow-hidden rounded-[14px] border border-border/60 bg-gradient-to-br from-background/95 to-background/60 p-6"
			>
				<div className="absolute inset-0 opacity-[0.06] bg-[radial-gradient(circle_at_30%_20%,theme(colors.primary.DEFAULT)_0%,transparent_50%)]" />
				<div className="relative flex items-center gap-5">
					<div className="flex h-20 w-20 items-center justify-center rounded-full bg-background/80 ring-1 ring-border/60 text-5xl leading-none">
						{stats.tierMeta.emoji}
					</div>
					<div className="min-w-0 flex-1">
						<p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground/60">
							Tier {stats.tier} · {stats.tierMeta.name}
						</p>
						<h2 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
							{stats.tierMeta.tagline}
						</h2>
						<p className="mt-1 text-sm text-muted-foreground">
							{stats.tier < 7 ? (
								<>
									{progressPercent}% to Tier {stats.tier + 1}
								</>
							) : (
								<>You&apos;ve reached the final tier. The sky is home.</>
							)}
						</p>
					</div>
				</div>
			</motion.div>

			{/* Tier ladder */}
			<div className="rounded-[14px] border border-border/60 bg-background/55 p-5">
				<p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/65">
					The ladder
				</p>
				<TierLadder currentTier={stats.tier} />
			</div>

			{/* Stats grid */}
			<div>
				<p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/65">
					Your numbers
				</p>
				<StatsGrid cumulative={stats.cumulative} />
			</div>

			{/* Usage heatmap */}
			<div className="rounded-[14px] border border-border/60 bg-background/55 p-5">
				<p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/65">
					Usage
				</p>
				<ContributionGraph />
			</div>

			{/* Leaderboard preview */}
			<div className="rounded-[14px] border border-border/60 bg-background/55 p-5">
				<div className="mb-3 flex items-center justify-between">
					<p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/65">
						Top climbers
					</p>
					<button
						type="button"
						onClick={() => void loadLeaderboard(10)}
						className="text-[10px] text-muted-foreground/70 hover:text-foreground"
					>
						Refresh
					</button>
				</div>
				{isLoadingLeaderboard && leaderboard.length === 0 ? (
					<p className="text-xs text-muted-foreground">Loading…</p>
				) : leaderboard.length === 0 ? (
					<p className="text-xs text-muted-foreground">
						No one else here yet. You&apos;re the pioneer.
					</p>
				) : (
					<ol className="space-y-1">
						{leaderboard.slice(0, 10).map((entry, idx) => (
							<li
								key={entry.userId}
								className="flex items-center justify-between rounded-[8px] px-2 py-1.5 text-sm hover:bg-background/80"
							>
								<div className="flex items-center gap-3 min-w-0">
									<span className="w-5 text-right text-xs text-muted-foreground">
										{idx + 1}
									</span>
									<span className="truncate text-foreground">
										{entry.githubUsername ?? entry.userId.slice(0, 8)}
									</span>
								</div>
								<span className="shrink-0 text-xs text-muted-foreground">
									T{entry.tier} · {Math.round(entry.score * 100)}
								</span>
							</li>
						))}
					</ol>
				)}
			</div>

			{/* Actions */}
			<div className="flex gap-2">
				<button
					type="button"
					disabled={stats.isSyncing}
					onClick={() => void stats.syncNow()}
					className="flex items-center gap-2 rounded-[8px] border border-border/60 bg-background/80 px-3 py-2 text-sm text-foreground transition-colors hover:bg-card disabled:opacity-50"
				>
					<ReloadIcon className={`h-3.5 w-3.5 ${stats.isSyncing ? 'animate-spin' : ''}`} />
					{stats.isSyncing ? 'Syncing…' : stats.pendingIsDirty ? 'Sync now' : 'All synced'}
				</button>
				<button
					type="button"
					onClick={() => void handleShare()}
					className="flex items-center gap-2 rounded-[8px] border border-border/60 bg-background/80 px-3 py-2 text-sm text-foreground transition-colors hover:bg-card"
				>
					<Share1Icon className="h-3.5 w-3.5" />
					Share card
				</button>
			</div>

			{stats.error ? (
				<p className="text-xs text-destructive">{stats.error}</p>
			) : null}
		</div>
	);
}
