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
	const lineCount = output?.split('\n').filter(Boolean).length;

	return (
		<ToolCard
			toolName="Bash"
			status={status}
			icon={<Terminal className={`h-3.5 w-3.5 shrink-0 ${status === 'running' ? 'text-muted-foreground animate-pulse' : 'text-muted-foreground'}`} />}
			label={status === 'running' ? 'Running Bash' : 'Ran Bash'}
			output={output}
			style={style}
		>
			<div className="space-y-1.5">
				{/* Command display */}
				<div className="flex items-start gap-2 text-xs">
					<span className="text-muted-foreground shrink-0 pt-0.5">$</span>
					<code className="flex-1 rounded-md bg-muted/40 px-2 py-1 font-mono text-foreground text-xs break-all leading-relaxed">
						{command}
					</code>
					{lineCount ? (
						<span className="shrink-0 rounded-full bg-muted/50 px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
							{lineCount} lines
						</span>
					) : null}
				</div>
				{/* Description */}
				{description ? (
					<p className="text-xs text-muted-foreground/70 pl-4">{description}</p>
				) : null}
			</div>
		</ToolCard>
	);
};
