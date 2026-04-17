/**
 * MentionDropdown - Floating search dropdown for @-mention file selection.
 *
 * Styling follows the same tokens as SlashCommandDropdown and @solo/ui Menu:
 * rounded-md popover surface, ring+shadow-xl elevation, rounded-sm items
 * with bg-accent highlight, fade-in-scale entrance.
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

const itemBase =
	'group w-full flex items-start gap-2 rounded-sm px-2 py-1 text-[13px] text-left ' +
	'cursor-default select-none outline-none transition-colors';
const itemIdle = 'hover:bg-accent hover:text-accent-foreground';
const itemActive = 'bg-accent text-accent-foreground';

export const MentionDropdown: FC<MentionDropdownProps> = ({
	results,
	selectedIndex,
	onSelect,
	position,
}) => {
	const listRef = useRef<HTMLDivElement>(null);
	const selectedRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		selectedRef.current?.scrollIntoView({ block: 'nearest' });
	}, [selectedIndex]);

	return (
		<div
			ref={listRef}
			className={
				'fixed z-50 w-72 max-h-60 overflow-y-auto rounded-md p-1 ' +
				'bg-popover text-popover-foreground ' +
				'ring-1 ring-black/5 dark:ring-white/10 shadow-xl ' +
				'animate-[fade-in-scale_150ms_cubic-bezier(0.16,1,0.3,1)]'
			}
			style={{ bottom: position.bottom, left: position.left }}
		>
			{results.length === 0 ? (
				<div className="px-2 py-2 text-[13px] text-muted-foreground text-center">
					No files found
				</div>
			) : (
				results.map((result, i) => {
					const isActive = i === selectedIndex;
					return (
						<button
							key={result.path}
							ref={isActive ? selectedRef : undefined}
							onClick={() => onSelect(result)}
							className={`${itemBase} ${isActive ? itemActive : itemIdle}`}
							type="button"
						>
							<span className="mt-[1px] shrink-0">
								<FileIcon fileName={result.name} autoAssign className="size-3.5" />
							</span>
							<div className="min-w-0 flex-1">
								<div className="truncate font-medium text-foreground">
									{result.name}
								</div>
								<div className="truncate text-[11px] text-muted-foreground">
									{result.relativePath}
								</div>
							</div>
						</button>
					);
				})
			)}
		</div>
	);
};
