/**
 * SlashCommandDropdown - Floating command palette for / slash commands and skills
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

	// Split commands and skills for grouped display
	const regularCommands = commands.filter((c) => c.category !== 'skill');
	const skills = commands.filter((c) => c.category === 'skill');

	return (
		<div
			className="fixed z-50 w-80 max-h-72 overflow-y-auto rounded-md bg-popover shadow-glass animate-in fade-in slide-in-from-bottom-2 duration-150"
			style={{ bottom: position.bottom, left: position.left }}
		>
			{commands.length === 0 ? (
				<div className="p-3 text-sm text-muted-foreground text-center">
					No commands found
				</div>
			) : (
				<>
					{regularCommands.map((cmd) => {
						const globalIdx = commands.indexOf(cmd);
						const Icon = cmd.icon;
						return (
							<button
								key={cmd.id}
								ref={globalIdx === selectedIndex ? selectedRef : undefined}
								onClick={() => onSelect(cmd)}
								className={`
									w-full flex items-center gap-3 px-3 py-2 text-sm text-left
									hover:bg-muted transition-colors
									${globalIdx === selectedIndex ? 'bg-muted' : ''}
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
					})}
					{skills.length > 0 && regularCommands.length > 0 && (
						<div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 border-t border-border/30">
							Skills
						</div>
					)}
					{skills.map((cmd) => {
						const globalIdx = commands.indexOf(cmd);
						return (
							<button
								key={cmd.id}
								ref={globalIdx === selectedIndex ? selectedRef : undefined}
								onClick={() => onSelect(cmd)}
								className={`
									w-full flex items-center gap-3 px-3 py-2 text-sm text-left
									hover:bg-muted transition-colors
									${globalIdx === selectedIndex ? 'bg-muted' : ''}
								`}
								type="button"
							>
								<Zap className={`w-4 h-4 shrink-0 ${cmd.attached ? 'text-primary' : 'text-muted-foreground'}`} />
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2">
										<span className="font-mono text-foreground">{cmd.label}</span>
										{cmd.source && (
											<span
												className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${SOURCE_BADGES[cmd.source].className}`}
											>
												{SOURCE_BADGES[cmd.source].label}
											</span>
										)}
										{cmd.attached && (
											<span className="text-[9px] font-semibold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
												Active
											</span>
										)}
									</div>
									<div className="truncate text-xs text-muted-foreground">
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
