/**
 * SlashCommandDropdown - Floating command palette for / slash commands and skills.
 *
 * Styling matches @solo/ui Menu / Popover tokens: rounded-md container with
 * ring-1 ring-black/5 and shadow-xl, items at rounded-sm px-2 py-1 with
 * bg-accent highlight, and fade-in-scale entrance. Badges render as small
 * tokenised chips (rounded-sm, not pill) for a flatter Codex look.
 */

import { useEffect, useRef } from 'react';
import { Zap } from 'lucide-react';

import type { FC, ComponentType } from 'react';
import type { SkillSource } from '../../../../bindings/SkillSource';

export interface SlashCommand {
	id: string;
	label: string;
	description: string;
	category: 'local' | 'agent' | 'skill';
	icon: ComponentType<{ className?: string; size?: number }>;
	/** For skills: whether the skill is currently attached */
	attached?: boolean;
	/** For skills: where the skill was discovered (drives the source badge) */
	source?: SkillSource;
}

const SOURCE_BADGES: Record<SkillSource, { label: string; className: string }> = {
	user: { label: 'Solo', className: 'text-primary bg-primary/10' },
	project: { label: 'Project', className: 'text-primary bg-primary/10' },
	claude_user: { label: 'Claude', className: 'text-orange-500 bg-orange-500/10' },
	claude_plugin: { label: 'Plugin', className: 'text-orange-500 bg-orange-500/10' },
	claude_project: { label: 'Claude·Proj', className: 'text-orange-500 bg-orange-500/10' },
	codex: { label: 'Codex', className: 'text-sky-500 bg-sky-500/10' },
};

export interface SlashCommandDropdownProps {
	commands: SlashCommand[];
	selectedIndex: number;
	onSelect: (command: SlashCommand) => void;
	position: { bottom: number; left: number };
}

const itemBase =
	'group w-full flex items-start gap-2 rounded-sm px-2 py-1 text-[13px] text-left ' +
	'cursor-default select-none outline-none transition-colors';
const itemIdle = 'hover:bg-accent hover:text-accent-foreground';
const itemActive = 'bg-accent text-accent-foreground';
const badgeBase =
	'shrink-0 inline-flex items-center rounded-sm px-1 py-0.5 text-[9px] ' +
	'font-semibold uppercase tracking-wide tabular-nums';

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

	const regularCommands = commands.filter((c) => c.category !== 'skill');
	const skills = commands.filter((c) => c.category === 'skill');

	return (
		<div
			className={
				'fixed z-50 max-h-72 w-[22rem] overflow-y-auto rounded-md p-1 ' +
				'bg-popover text-popover-foreground ' +
				'ring-1 ring-black/5 dark:ring-white/10 shadow-xl ' +
				'animate-[fade-in-scale_150ms_cubic-bezier(0.16,1,0.3,1)]'
			}
			style={{ bottom: position.bottom, left: position.left }}
		>
			{commands.length === 0 ? (
				<div className="px-2 py-2 text-[13px] text-muted-foreground text-center">
					No commands found
				</div>
			) : (
				<>
					{regularCommands.map((cmd) => {
						const globalIdx = commands.indexOf(cmd);
						const isActive = globalIdx === selectedIndex;
						const Icon = cmd.icon;
						return (
							<button
								key={cmd.id}
								ref={isActive ? selectedRef : undefined}
								onClick={() => onSelect(cmd)}
								className={`${itemBase} ${isActive ? itemActive : itemIdle}`}
								type="button"
							>
								<Icon className="mt-[1px] size-3.5 shrink-0 text-muted-foreground group-hover:text-accent-foreground" />
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-1.5">
										<span className="font-mono text-foreground truncate">/{cmd.id}</span>
									</div>
									<div className="truncate text-[11px] text-muted-foreground">
										{cmd.description}
									</div>
								</div>
							</button>
						);
					})}

					{skills.length > 0 && regularCommands.length > 0 && (
						<div className="mt-1 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
							Skills
						</div>
					)}

					{skills.map((cmd) => {
						const globalIdx = commands.indexOf(cmd);
						const isActive = globalIdx === selectedIndex;
						return (
							<button
								key={cmd.id}
								ref={isActive ? selectedRef : undefined}
								onClick={() => onSelect(cmd)}
								className={`${itemBase} ${isActive ? itemActive : itemIdle}`}
								type="button"
							>
								<Zap
									className={`mt-[1px] size-3.5 shrink-0 ${
										cmd.attached ? 'text-primary' : 'text-muted-foreground group-hover:text-accent-foreground'
									}`}
								/>
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-1.5">
										<span className="font-mono text-foreground truncate">{cmd.label}</span>
										{cmd.source && (
											<span className={`${badgeBase} ${SOURCE_BADGES[cmd.source].className}`}>
												{SOURCE_BADGES[cmd.source].label}
											</span>
										)}
										{cmd.attached && (
											<span className={`${badgeBase} text-primary bg-primary/10`}>
												Active
											</span>
										)}
									</div>
									<div className="truncate text-[11px] text-muted-foreground">
										{cmd.description}
									</div>
								</div>
							</button>
						);
					})}
				</>
			)}
		</div>
	);
};
