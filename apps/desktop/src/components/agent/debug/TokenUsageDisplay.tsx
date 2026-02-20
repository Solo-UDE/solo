/**
 * Token usage display — shows per-turn and cumulative token counts + cost.
 */

import type { FC } from 'react';
import { useDebugStore, type TokenAccum } from '../../../stores/debugStore';

const TokenRow: FC<{ label: string; value: number; dimmed?: boolean }> = ({ label, value, dimmed }) => (
	<div className="flex items-center justify-between px-2 py-0.5">
		<span className={`text-xs ${dimmed ? 'text-muted-foreground/50' : 'text-muted-foreground'}`}>{label}</span>
		<span className={`text-xs font-mono ${dimmed ? 'text-muted-foreground/50' : 'text-foreground/80'}`}>
			{value.toLocaleString()}
		</span>
	</div>
);

const TokenSection: FC<{ title: string; accum: TokenAccum }> = ({ title, accum }) => (
	<div className="mb-3">
		<div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">
			{title}
		</div>
		<TokenRow label="Input tokens" value={accum.inputTokens} />
		<TokenRow label="Output tokens" value={accum.outputTokens} />
		<TokenRow label="Cache read" value={accum.cacheReadInputTokens} dimmed={accum.cacheReadInputTokens === 0} />
		<TokenRow label="Cache creation" value={accum.cacheCreationInputTokens} dimmed={accum.cacheCreationInputTokens === 0} />
		{accum.turnCount > 0 && (
			<TokenRow label="Turns" value={accum.turnCount} />
		)}
		{accum.totalCostUsd > 0 && (
			<div className="flex items-center justify-between px-2 py-0.5 mt-1 border-t border-border/20">
				<span className="text-xs text-muted-foreground">Cost</span>
				<span className="text-xs font-mono text-emerald-400">
					${accum.totalCostUsd.toFixed(4)}
				</span>
			</div>
		)}
	</div>
);

export const TokenUsageDisplay: FC = () => {
	const tokenUsage = useDebugStore((s) => s.tokenUsage);

	return (
		<div className="flex flex-col h-full overflow-y-auto">
			<TokenSection title="Current Turn" accum={tokenUsage.turn} />
			<TokenSection title="Session Total" accum={tokenUsage.session} />
		</div>
	);
};
