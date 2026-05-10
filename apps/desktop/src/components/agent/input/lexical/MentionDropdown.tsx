/**
 * MentionDropdown — Codex-style single-line file picker for @-mentions.
 *
 * Shares the same row layout as SlashCommandDropdown: one row per result,
 * icon + name + inline path description. Blurred translucent popover
 * surface with subtle ring.
 */

import { FileIcon } from '@react-symbols/icons/utils';
import { VirtualList } from '@/components/ui/virtual-list';

import type { FileSearchResult } from '../../../../lib/fuzzySearch';
import type { FC } from 'react';

export interface MentionDropdownProps {
	results: FileSearchResult[];
	selectedIndex: number;
	onSelect: (result: FileSearchResult) => void;
	position: { bottom: number; left: number };
}

// Concentric radii (border-radius.md): outer rounded-2xl minus p-1.5 ≈ rounded-xl inner.
const itemBase =
	'group flex w-full items-center gap-2 rounded-xl px-3 h-7 text-[13px] text-left ' +
	'cursor-default select-none outline-none transition-colors';
const itemIdle = 'text-foreground/90 hover:bg-accent hover:text-accent-foreground';
const itemActive = 'bg-accent text-accent-foreground';

export const MentionDropdown: FC<MentionDropdownProps> = ({
	results,
	selectedIndex,
	onSelect,
	position,
}) => {
	return (
		<div
			className={
				'fixed z-50 w-[32rem] rounded-2xl p-1.5 ' +
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
				<VirtualList
					items={results}
					estimateSize={() => 28}
					overscan={10}
					measureElement={false}
					className="max-h-80"
					getItemKey={(result) => result.path}
					testId="mention-dropdown-results"
					scrollToIndex={selectedIndex}
					renderItem={(result, i) => {
						const isActive = i === selectedIndex;
						return (
							<button
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
					}}
				/>
			)}
		</div>
	);
};
