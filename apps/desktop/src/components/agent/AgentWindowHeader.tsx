import { GearIcon, PlusIcon } from '@radix-ui/react-icons';
import { Bot } from 'lucide-react';
import { IconButton } from '@solo/ui';

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
					<Bot className="w-4 h-4 text-secondary-foreground" />
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
					<IconButton
						variant="ghost"
						size="sm"
						onClick={onNewSession}
						title="New session"
					>
						<PlusIcon width={16} height={16} className="text-muted-foreground" />
					</IconButton>
				)}
				{onSettings && (
					<IconButton
						variant="ghost"
						size="sm"
						onClick={onSettings}
						title="Settings"
					>
						<GearIcon width={16} height={16} className="text-muted-foreground" />
					</IconButton>
				)}
			</div>
		</header>
	);
};
