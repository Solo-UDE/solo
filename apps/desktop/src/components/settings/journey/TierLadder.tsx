/**
 * Horizontal strip of the 7 tier emojis. Current tier is scaled up; past
 * tiers full-opacity, future tiers dimmed. Clicking a tier reveals a tooltip
 * with the tier's name and unlock message.
 */

import { motion } from 'motion/react';
import { TIER_META, type TierIndex } from '@solo/tier-names';

interface TierLadderProps {
	currentTier: TierIndex;
	progress: number;
}

const TIER_INDICES: TierIndex[] = [1, 2, 3, 4, 5, 6, 7];

export function TierLadder({ currentTier, progress }: TierLadderProps) {
	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-2">
				{TIER_INDICES.map((t) => {
					const meta = TIER_META[t];
					const isPast = t < currentTier;
					const isCurrent = t === currentTier;
					const scale = isCurrent ? 1.4 : isPast ? 1 : 0.75;
					const opacity = isCurrent ? 1 : isPast ? 0.75 : 0.25;
					return (
						<motion.div
							key={t}
							className="flex flex-1 flex-col items-center gap-1"
							initial={false}
							animate={{ scale, opacity }}
							transition={{ type: 'spring', stiffness: 340, damping: 28 }}
						>
							<span className="text-2xl leading-none">{meta.emoji}</span>
							<span
								className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${
									isCurrent ? 'text-foreground' : 'text-muted-foreground/60'
								}`}
							>
								{meta.name}
							</span>
						</motion.div>
					);
				})}
			</div>
			<div className="relative h-1 overflow-hidden rounded-full bg-border/60">
				<motion.div
					className="absolute inset-y-0 left-0 rounded-full bg-primary"
					initial={{ width: 0 }}
					animate={{
						width: `${Math.min(100, Math.max(0, ((currentTier - 1) / 7 + progress / 7) * 100))}%`,
					}}
					transition={{ type: 'spring', stiffness: 120, damping: 20 }}
				/>
			</div>
		</div>
	);
}
