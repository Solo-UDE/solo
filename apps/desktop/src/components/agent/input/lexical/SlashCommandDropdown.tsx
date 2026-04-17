/**
 * SlashCommandDropdown — Codex-style single-line command palette.
 *
 * Visual reference: OpenAI Codex app's / menu. Each row is one line:
 *   [icon] Name   description text that fills and truncates
 *
 * Source (SOLO / plugin / Claude / Codex) is conveyed by icon tint rather
 * than a text badge, so the layout stays dense. The container uses a
 * blurred, translucent surface matching other overlay popovers.
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
	attached?: boolean;
	source?: SkillSource;
}

const SOURCE_ICON_TINT: Record<SkillSource, string> = {
	user: 'text-primary',
	project: 'text-primary',
	claude_user: 'text-orange-500',
	claude_plugin: 'text-orange-500',
	claude_project: 'text-orange-500',
	codex: 'text-sky-500',
};

export interface SlashCommandDropdownProps {
	commands: SlashCommand[];
	selectedIndex: number;
	onSelect: (command: SlashCommand) => void;
	position: { bottom: number; left: number };
}

const itemBase =
	'group flex w-full items-center gap-2 rounded-sm px-2 h-7 text-[13px] text-left ' +
	'cursor-default select-none outline-none transition-colors';
const itemIdle = 'text-foreground/90 hover:bg-accent hover:text-accent-foreground';
const itemActive = 'bg-accent text-accent-foreground';

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
				'fixed z-50 max-h-80 w-[32rem] overflow-y-auto rounded-lg p-1 ' +
				'bg-popover/90 backdrop-blur-md text-popover-foreground ' +
				'ring-1 ring-black/10 dark:ring-white/10 shadow-xl ' +
				'animate-[fade-in-scale_150ms_cubic-bezier(0.16,1,0.3,1)]'
			}
			style={{ bottom: position.bottom, left: position.left }}
		>
			{commands.length === 0 ? (
				<div className="h-7 flex items-center justify-center text-[13px] text-muted-foreground">
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
								<Icon className="size-4 shrink-0 text-muted-foreground/90 group-hover:text-accent-foreground" />
								<span className="shrink-0 font-medium">{cmd.label || `/${cmd.id}`}</span>
								<span className="min-w-0 flex-1 truncate text-muted-foreground/90 group-hover:text-accent-foreground/80">
									{cmd.description}
								</span>
							</button>
						);
					})}

					{skills.length > 0 && (
						<div className="mt-1 px-2 pb-0.5 pt-1.5 text-[11px] font-medium text-muted-foreground/80">
							Skills
						</div>
					)}

					{skills.map((cmd) => {
						const globalIdx = commands.indexOf(cmd);
						const isActive = globalIdx === selectedIndex;
						const tint = cmd.source ? SOURCE_ICON_TINT[cmd.source] : 'text-muted-foreground/90';
						return (
							<button
								key={cmd.id}
								ref={isActive ? selectedRef : undefined}
								onClick={() => onSelect(cmd)}
								className={`${itemBase} ${isActive ? itemActive : itemIdle}`}
								type="button"
							>
								<Zap
									className={`size-4 shrink-0 ${
										cmd.attached ? 'text-primary' : tint
									} group-hover:text-accent-foreground`}
								/>
								<span className="shrink-0 font-medium">{cmd.label}</span>
								<span className="min-w-0 flex-1 truncate text-muted-foreground/90 group-hover:text-accent-foreground/80">
									{cmd.description}
								</span>
								{cmd.attached && (
									<span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-primary">
										Active
									</span>
								)}
							</button>
						);
					})}
				</>
			)}
		</div>
	);
};
