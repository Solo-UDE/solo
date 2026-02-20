/**
 * StreamingSkeleton — Processing indicator shown during dead spaces.
 *
 * Uses ThinkingDots (3×3 diagonal wave grid) with a shimmer label
 * to indicate the agent is processing between visible outputs.
 *
 * Shown:
 * - Before first token arrives (submitted → streaming transition)
 * - Between tool calls when the agent is thinking
 * - After tool completion while waiting for next narrative
 */

import { ThinkingDots } from './ThinkingDots';
import { TextShimmer } from './TextShimmer';

import type { FC } from 'react';

export interface StreamingSkeletonProps {
	readonly className?: string;
	/** Label displayed next to dots (default: "Processing...") */
	readonly label?: string;
}

export const StreamingSkeleton: FC<StreamingSkeletonProps> = ({
	className = '',
	label = 'Processing...',
}) => (
	<div className={`flex items-center gap-3 py-2 ${className}`} role="status" aria-label={label}>
		<ThinkingDots size={20} speed={1.2} />
		<TextShimmer className="text-xs" duration={3}>{label}</TextShimmer>
	</div>
);
