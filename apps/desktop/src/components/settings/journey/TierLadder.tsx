/**
 * Horizontal strip of the 7 tier emojis. Current tier is scaled up; past
 * tiers full-opacity, future tiers dimmed and blurred. Clicking a tier
 * reveals a tooltip with the tier's name and unlock message.
 */

import { motion } from 'motion/react';
import { TIER_META, type TierIndex } from '@solo/tier-names';

interface TierLadderProps {
	currentTier: TierIndex;
}

const TIER_INDICES: TierIndex[] = [1, 2, 3, 4, 5, 6, 7];

export function TierLadder({ currentTier }: TierLadderProps) {
	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-2">
				{TIER_INDICES.map((t) => {
					const meta = TIER_META[t];
					const isPast = t < currentTier;
					const isCurrent = t === currentTier;
					const scale = isCurrent ? 1.4 : isPast ? 1 : 0.75;
					const opacity = isCurrent ? 1 : isPast ? 0.75 : 0.35;
					// Future tiers blur progressively by distance — closer ones are
					// almost-readable, far ones are teaser-dreamy. Past and current stay sharp.
					const distance = Math.max(0, t - currentTier);
					const blur = distance === 0 ? 0 : Math.min(6, 1.5 + distance * 0.9);
					return (
						<motion.div
							key={t}
							className="flex flex-1 flex-col items-center gap-1 will-change-[filter,transform,opacity]"
							initial={false}
							animate={{ scale, opacity, filter: `blur(${blur}px)` }}
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
		</div>
	);
}
