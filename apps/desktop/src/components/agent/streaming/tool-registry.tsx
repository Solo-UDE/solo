/**
 * Tool Registry — Maps tool names to specialized card components.
 *
 * Replaces the if-chain in agent-message.tsx with a declarative Map.
 * Adding a new tool visualization is a one-line addition here.
 */

import { BashToolCard } from './BashToolCard';
import { FileToolCard } from './FileToolCard';
import { SearchToolCard } from './SearchToolCard';
import { WebToolCard } from './WebToolCard';
import { TaskToolCard } from './TaskToolCard';
import { ToolCard } from './ToolCard';

import type { CSSProperties, FC, ReactNode } from 'react';
import type { ToolStatus } from './ToolCard';

/** Props passed to every tool widget from the message renderer */
export interface ToolWidgetProps {
	readonly toolName: string;
	readonly toolInput: Record<string, unknown>;
	readonly status: ToolStatus;
	readonly output?: string;
	readonly style?: CSSProperties;
}

/** Helper to extract string from tool input */
const getStr = (input: Record<string, unknown>, key: string, fallback = ''): string => {
	const value = input[key];
	return typeof value === 'string' ? value : fallback;
};

// ---------------------------------------------------------------------------
// Adapter wrappers — convert ToolWidgetProps to specialized card props
// ---------------------------------------------------------------------------

const BashAdapter: FC<ToolWidgetProps> = ({ toolInput, status, output, style }) => (
	<BashToolCard
		command={getStr(toolInput, 'command')}
		description={getStr(toolInput, 'description') || undefined}
		output={output}
		status={status}
		style={style}
	/>
);

const FileAdapter: FC<ToolWidgetProps> = ({ toolName, toolInput, status, output, style }) => (
	<FileToolCard
		toolName={toolName}
		filePath={getStr(toolInput, 'file_path', 'unknown')}
		output={output}
		status={status}
		style={style}
	/>
);

const SearchAdapter: FC<ToolWidgetProps> = ({ toolName, toolInput, status, output, style }) => (
	<SearchToolCard
		toolName={toolName}
		pattern={getStr(toolInput, 'pattern', '*')}
		path={getStr(toolInput, 'path') || undefined}
		output={output}
		status={status}
		outputMode={getStr(toolInput, 'output_mode') || undefined}
		glob={getStr(toolInput, 'glob') || undefined}
		fileType={getStr(toolInput, 'type') || undefined}
		style={style}
	/>
);

const WebAdapter: FC<ToolWidgetProps> = ({ toolName, toolInput, status, output, style }) => (
	<WebToolCard
		toolName={toolName}
		query={getStr(toolInput, 'query') || undefined}
		url={getStr(toolInput, 'url') || undefined}
		prompt={getStr(toolInput, 'prompt') || undefined}
		output={output}
		status={status}
		style={style}
	/>
);

const TaskAdapter: FC<ToolWidgetProps> = ({ toolInput, status, output, style }) => (
	<TaskToolCard
		description={getStr(toolInput, 'description')}
		prompt={getStr(toolInput, 'prompt') || undefined}
		subagentType={getStr(toolInput, 'subagent_type', 'general-purpose')}
		model={getStr(toolInput, 'model') || undefined}
		output={output}
		status={status}
		style={style}
	/>
);

const GenericAdapter: FC<ToolWidgetProps> = ({ toolName, toolInput, status, output, style }) => (
	<ToolCard
		toolName={toolName}
		status={status}
		primaryDisplay={Object.values(toolInput).find((v) => typeof v === 'string') as string | undefined}
		output={output}
		style={style}
	/>
);

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry = new Map<string, FC<ToolWidgetProps>>([
	['bash', BashAdapter],
	['read', FileAdapter],
	['write', FileAdapter],
	['edit', FileAdapter],
	['glob', SearchAdapter],
	['grep', SearchAdapter],
	['websearch', WebAdapter],
	['webfetch', WebAdapter],
	['task', TaskAdapter],
]);

/**
 * Get the widget component for a given tool name.
 * Falls back to the generic ToolCard for unregistered tools.
 */
export const getToolWidget = (toolName: string): FC<ToolWidgetProps> =>
	registry.get(toolName.toLowerCase()) ?? GenericAdapter;

/**
 * Render a tool widget by name — convenience function for use in JSX.
 */
export const renderToolCard = (
	key: string,
	toolName: string,
	toolInput: Record<string, unknown>,
	status: ToolStatus,
	output?: string,
	style?: CSSProperties,
): ReactNode => {
	const Widget = getToolWidget(toolName);
	return <Widget key={key} toolName={toolName} toolInput={toolInput} status={status} output={output} style={style} />;
};
