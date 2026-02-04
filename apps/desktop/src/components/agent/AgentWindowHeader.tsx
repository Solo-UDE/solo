import { Robot, GearSix, Plus } from '@phosphor-icons/react';

import type { FC } from 'react';

export interface AgentWindowHeaderProps {
	sessionId: string | null;
	agentName?: string;
	model?: string;
	onNewSession?: () => void;
	onSettings?: () => void;
	className?: string;
}

export const AgentWindowHeader: FC<AgentWindowHeaderProps> = ({
	sessionId: _sessionId, // Reserved for future session display
	agentName = 'Claude',
	model,
	onNewSession,
	onSettings,
	className = '',
}) => {
	return (
		<header
			className={`flex items-center justify-between px-4 py-2 border-b border-border bg-background/95 backdrop-blur-sm ${className}`}
		>
			{/* Left: Agent info */}
			<div className="flex items-center gap-3">
				<div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
					<Robot className="w-4 h-4 text-secondary-foreground" />
				</div>
				<div className="flex flex-col">
					<span className="text-sm font-medium text-foreground">{agentName}</span>
					{model && (
						<span className="text-xs text-muted-foreground">{model}</span>
					)}
				</div>
			</div>

			{/* Right: Actions */}
			<div className="flex items-center gap-1">
				{onNewSession && (
					<button
						onClick={onNewSession}
						className="p-1.5 rounded-md hover:bg-muted/60 transition-colors"
						title="New session"
					>
						<Plus className="w-4 h-4 text-muted-foreground" />
					</button>
				)}
				{onSettings && (
					<button
						onClick={onSettings}
						className="p-1.5 rounded-md hover:bg-muted/60 transition-colors"
						title="Settings"
					>
						<GearSix className="w-4 h-4 text-muted-foreground" />
					</button>
				)}
			</div>
		</header>
	);
};
