/**
 * FileToolCard — Specialized tool card for file operations (Read, Write, Edit).
 *
 * Shows file icon, path display with filename highlight,
 * operation label (edited/read/created), and line count.
 */

import { FileTextIcon, Pencil2Icon } from '@radix-ui/react-icons';
import { FilePlus } from 'lucide-react';

import { ToolCard } from './ToolCard';

import type { FC, ReactNode } from 'react';
import type { ToolStatus } from './ToolCard';

export interface FileToolCardProps {
	readonly toolName: 'Read' | 'Write' | 'Edit' | string;
	readonly filePath: string;
	readonly output?: string;
	readonly status: ToolStatus;
	/** Extra content like diff stats or code preview */
	readonly children?: ReactNode;
	readonly style?: React.CSSProperties;
}

const getFileIcon = (toolName: string): ReactNode => {
	const cls = 'h-3.5 w-3.5 shrink-0 text-muted-foreground';
	switch (toolName.toLowerCase()) {
		case 'edit': return <Pencil2Icon width={14} height={14} className="shrink-0 text-muted-foreground" />;
		case 'write': return <FilePlus className={cls} />;
		default: return <FileTextIcon width={14} height={14} className="shrink-0 text-muted-foreground" />;
	}
};

const getLabel = (toolName: string, status: ToolStatus): string => {
	const name = toolName.toLowerCase();
	if (status === 'running') {
		if (name === 'edit') return 'Editing';
		if (name === 'write') return 'Writing';
		return 'Reading';
	}
	if (name === 'edit') return 'Edited';
	if (name === 'write') return 'Created';
	return 'Read';
};

export const FileToolCard: FC<FileToolCardProps> = ({
	toolName,
	filePath,
	output,
	status,
	children,
	style,
}) => {
	const fileName = filePath.split('/').pop() ?? filePath;
	const dirPath = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/') + 1) : '';
	const lineCount = output?.split('\n').length;

	return (
		<ToolCard
			toolName={toolName}
			status={status}
			icon={getFileIcon(toolName)}
			label={getLabel(toolName, status)}
			primaryDisplay={filePath}
			collapsible={!!output || !!children}
			defaultExpanded={false}
			output={output}
			style={style}
		>
			{lineCount !== undefined || children ? (
				<div className="flex min-w-0 items-center gap-1.5 text-xs">
					{/* Directory path (muted) + filename (foreground) */}
					<span className="min-w-0 truncate font-mono" title={filePath}>
						<span className="text-muted-foreground/60">{dirPath}</span>
						<span className="font-medium text-foreground">{fileName}</span>
					</span>
					{lineCount !== undefined ? (
						<span className="shrink-0 rounded-full bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground tabular-nums">
							{lineCount} lines
						</span>
					) : null}
					{children}
				</div>
			) : null}
		</ToolCard>
	);
};
