/**
 * SlashCommandDropdown - Floating command palette for / slash commands
 */

import { useEffect, useRef } from 'react';

import type { FC } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface SlashCommand {
	id: string;
	label: string;
	description: string;
	category: 'local' | 'agent';
	icon: LucideIcon;
}

export interface SlashCommandDropdownProps {
	commands: SlashCommand[];
	selectedIndex: number;
	onSelect: (command: SlashCommand) => void;
	position: { top: number; left: number };
}

export const SlashCommandDropdown: FC<SlashCommandDropdownProps> = ({
	commands,
	selectedIndex,
	onSelect,
	position,
}) => {
	const selectedRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		selectedRef.current?.scrollIntoView({ block: 'nearest' });
	}, [selectedIndex]);

	return (
		<div
			className="fixed z-50 w-80 max-h-72 overflow-y-auto rounded-md border border-border bg-popover shadow-lg"
			style={{ top: position.top, left: position.left }}
		>
			{commands.length === 0 ? (
				<div className="p-3 text-sm text-muted-foreground text-center">
					No commands found
				</div>
			) : (
				commands.map((cmd, i) => {
					const Icon = cmd.icon;
					return (
						<button
							key={cmd.id}
							ref={i === selectedIndex ? selectedRef : undefined}
							onClick={() => onSelect(cmd)}
							className={`
								w-full flex items-center gap-3 px-3 py-2 text-sm text-left
								hover:bg-muted transition-colors
								${i === selectedIndex ? 'bg-muted' : ''}
							`}
							type="button"
						>
							<Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<span className="font-mono text-foreground">/{cmd.id}</span>
								</div>
								<div className="truncate text-xs text-muted-foreground">
									{cmd.description}
								</div>
							</div>
						</button>
					);
				})
			)}
		</div>
	);
};
