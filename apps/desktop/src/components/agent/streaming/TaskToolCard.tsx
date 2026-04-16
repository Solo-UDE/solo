/**
 * TaskToolCard — Specialized tool card for nested agent tasks.
 *
 * Shows robot icon, task description, subagent type badge,
 * optional model badge, and nested agent output.
 */

import { Bot } from 'lucide-react';

import { ToolCard } from './ToolCard';

import type { FC } from 'react';
import type { ToolStatus } from './ToolCard';

export interface TaskToolCardProps {
	readonly description: string;
	readonly prompt?: string;
	readonly subagentType?: string;
	readonly model?: string;
	readonly output?: string;
	readonly status: ToolStatus;
	readonly style?: React.CSSProperties;
}

export const TaskToolCard: FC<TaskToolCardProps> = ({
	description,
	subagentType = 'general-purpose',
	model,
	output,
	status,
	style,
}) => (
	<ToolCard
		toolName="Task"
		status={status}
		icon={<Bot className={`h-3.5 w-3.5 shrink-0 ${status === 'running' ? 'text-primary animate-pulse' : 'text-muted-foreground'}`} />}
		label={status === 'running' ? 'Running Task...' : 'Task'}
		primaryDisplay={description}
		output={output}
		defaultExpanded={false}
		style={style}
	>
		<div className="flex items-center gap-1.5">
			<span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted/50 text-muted-foreground">
				{subagentType}
			</span>
			{model ? (
				<span className="text-[10px] px-1.5 py-0.5 rounded-md bg-primary/10 text-primary">
					{model}
				</span>
			) : null}
		</div>
	</ToolCard>
);
