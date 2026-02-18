/**
 * MentionDropdown - Floating search dropdown for @-mention file selection
 */

import { FileIcon } from '@react-symbols/icons/utils';
import { useEffect, useRef } from 'react';

import type { FileSearchResult } from '../../../../lib/fuzzySearch';
import type { FC } from 'react';

export interface MentionDropdownProps {
	results: FileSearchResult[];
	selectedIndex: number;
	onSelect: (result: FileSearchResult) => void;
	position: { bottom: number; left: number };
}

export const MentionDropdown: FC<MentionDropdownProps> = ({
	results,
	selectedIndex,
	onSelect,
	position,
}) => {
	const listRef = useRef<HTMLDivElement>(null);
	const selectedRef = useRef<HTMLButtonElement>(null);

	// Scroll selected item into view
	useEffect(() => {
		selectedRef.current?.scrollIntoView({ block: 'nearest' });
	}, [selectedIndex]);

	return (
		<div
			ref={listRef}
			className="fixed z-50 w-72 max-h-60 overflow-y-auto rounded-md bg-popover shadow-glass"
			style={{ bottom: position.bottom, left: position.left }}
		>
			{results.length === 0 ? (
				<div className="p-3 text-sm text-muted-foreground text-center">
					No files found
				</div>
			) : (
				results.map((result, i) => (
					<button
						key={result.path}
						ref={i === selectedIndex ? selectedRef : undefined}
						onClick={() => onSelect(result)}
						className={`
							w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left
							hover:bg-muted transition-colors
							${i === selectedIndex ? 'bg-muted' : ''}
						`}
						type="button"
					>
						<span className="shrink-0">
							<FileIcon fileName={result.name} autoAssign className="w-4 h-4" />
						</span>
						<div className="min-w-0 flex-1">
							<div className="truncate font-medium text-foreground">
								{result.name}
							</div>
							<div className="truncate text-xs text-muted-foreground">
								{result.relativePath}
							</div>
						</div>
					</button>
				))
			)}
		</div>
	);
};
