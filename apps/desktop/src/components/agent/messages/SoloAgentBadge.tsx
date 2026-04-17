import type { FC } from 'react';

export const SoloAgentBadge: FC = () => {
	return (
		<span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/80 px-2.5 py-1 text-[11px] font-medium text-foreground">
			<span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
			Solo
		</span>
	);
};
