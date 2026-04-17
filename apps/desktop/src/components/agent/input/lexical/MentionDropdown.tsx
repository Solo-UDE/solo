/**
 * MentionDropdown — Codex-style single-line file picker for @-mentions.
 *
 * Shares the same row layout as SlashCommandDropdown: one row per result,
 * icon + name + inline path description. Blurred translucent popover
 * surface with subtle ring.
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
	'group flex w-full items-center gap-2 rounded-sm px-2 h-7 text-[13px] text-left ' +
	'cursor-default select-none outline-none transition-colors';
const itemIdle = 'text-foreground/90 hover:bg-accent hover:text-accent-foreground';
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
				'fixed z-50 w-[32rem] max-h-80 overflow-y-auto rounded-lg p-1 ' +
				'bg-popover/90 backdrop-blur-md text-popover-foreground ' +
				'ring-1 ring-black/10 dark:ring-white/10 shadow-xl ' +
				'animate-[fade-in-scale_150ms_cubic-bezier(0.16,1,0.3,1)]'
			}
			style={{ bottom: position.bottom, left: position.left }}
		>
			{results.length === 0 ? (
				<div className="h-7 flex items-center justify-center text-[13px] text-muted-foreground">
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
							<span className="shrink-0">
								<FileIcon fileName={result.name} autoAssign className="size-4" />
							</span>
							<span className="shrink-0 font-medium truncate max-w-[16rem]">
								{result.name}
							</span>
							<span className="min-w-0 flex-1 truncate text-muted-foreground/90 group-hover:text-accent-foreground/80">
								{result.relativePath}
							</span>
						</button>
					);
				})
			)}
		</div>
	);
};
