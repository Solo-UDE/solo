/**
 * WebToolCard — Specialized tool card for WebSearch/WebFetch operations.
 *
 * Shows globe icon, URL or query display, and response preview.
 */

import { GlobeIcon } from '@radix-ui/react-icons';

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
	readonly style?: React.CSSProperties;
}

export const WebToolCard: FC<WebToolCardProps> = ({
	toolName,
	query,
	url,
	output,
	status,
	style,
}) => {
	const isSearch = toolName.toLowerCase() === 'websearch';
	const display = query ?? url ?? '';

	return (
		<ToolCard
			toolName={toolName}
			status={status}
			icon={<GlobeIcon width={14} height={14} className="shrink-0 text-muted-foreground" />}
			label={
				status === 'running'
					? (isSearch ? 'Searching web' : 'Fetching page')
					: `Ran ${isSearch ? 'Web Search' : 'Web Fetch'}`
			}
			primaryDisplay={display}
			output={output}
			defaultExpanded={false}
			style={style}
		/>
	);
};
