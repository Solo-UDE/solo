/**
 * SDK state indicator — shows current model, thinking mode, plan mode.
 */

import type { FC } from 'react';
import { useDebugStore } from '../../../stores/debugStore';

const StatePill: FC<{ label: string; value: string; active?: boolean }> = ({ label, value, active }) => (
	<div className="flex items-center gap-1.5">
		<span className="text-[10px] text-muted-foreground/60 uppercase">{label}</span>
		<span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${active ? 'bg-primary/20 text-primary' : 'bg-muted/40 text-muted-foreground'}`}>
			{value}
		</span>
	</div>
);

export const SDKStateIndicator: FC = () => {
	const sdkState = useDebugStore((s) => s.sdkState);

	const thinkingLabel = sdkState.thinkingEnabled
		? sdkState.thinkingBudget <= 4096 ? 'think' : sdkState.thinkingBudget <= 10240 ? 'hard' : 'ultra'
		: 'off';

	return (
		<div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
			<StatePill label="Model" value={sdkState.model} active />
			<StatePill label="Thinking" value={thinkingLabel} active={sdkState.thinkingEnabled} />
			<StatePill label="Plan" value={sdkState.planMode ? 'on' : 'off'} active={sdkState.planMode} />
			<StatePill label="Accept" value={sdkState.acceptMode ? 'on' : 'off'} active={sdkState.acceptMode} />
			<StatePill label="Mode" value={sdkState.sessionMode} />
		</div>
	);
};
