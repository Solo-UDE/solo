/**
 * BashToolCard — Specialized tool card for Bash/terminal commands.
 *
 * Shows terminal icon, command in mono block, description,
 * output line count badge, and full output in collapsible section.
 */

import { Terminal } from 'lucide-react';

import { ToolCard } from './ToolCard';

import type { FC } from 'react';
import type { ToolStatus } from './ToolCard';

export interface BashToolCardProps {
	readonly command: string;
	readonly description?: string;
	readonly output?: string;
	readonly status: ToolStatus;
	readonly style?: React.CSSProperties;
}

export const BashToolCard: FC<BashToolCardProps> = ({
	command,
	description,
	output,
	status,
	style,
}) => {
	return (
		<ToolCard
			toolName="Bash"
			status={status}
			icon={<Terminal className={`h-3.5 w-3.5 shrink-0 ${status === 'running' ? 'text-muted-foreground animate-pulse' : 'text-muted-foreground'}`} />}
			label={status === 'running' ? 'Running Bash' : 'Ran Bash'}
			primaryDisplay={command}
			output={output}
			defaultExpanded={false}
			style={style}
		>
			{description ? (
				<div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground/74">
					<p className="min-w-0 truncate" title={description}>{description}</p>
				</div>
			) : null}
		</ToolCard>
	);
};
