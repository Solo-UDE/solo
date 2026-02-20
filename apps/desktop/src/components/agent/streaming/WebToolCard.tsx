/**
 * WebToolCard — Specialized tool card for WebSearch/WebFetch operations.
 *
 * Shows globe icon, URL or query display, and response preview.
 */

import { Globe } from '@phosphor-icons/react';

import { ToolCard } from './ToolCard';

import type { FC } from 'react';
import type { ToolStatus } from './ToolCard';

export interface WebToolCardProps {
	readonly toolName: 'WebSearch' | 'WebFetch' | string;
	readonly query?: string;
	readonly url?: string;
	readonly prompt?: string;
	readonly output?: string;
	readonly status: ToolStatus;
}

export const WebToolCard: FC<WebToolCardProps> = ({
	toolName,
	query,
	url,
	output,
	status,
}) => {
	const isSearch = toolName.toLowerCase() === 'websearch';
	const display = query ?? url ?? '';

	return (
		<ToolCard
			toolName={toolName}
			status={status}
			icon={<Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
			label={
				status === 'running'
					? (isSearch ? 'Searching web...' : 'Fetching page...')
					: (isSearch ? 'Web Search' : 'Web Fetch')
			}
			primaryDisplay={display}
			output={output}
			defaultExpanded={false}
		/>
	);
};
