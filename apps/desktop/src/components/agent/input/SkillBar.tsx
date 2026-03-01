/**
 * SkillBar - Displays attached skill chips below the editor.
 * Skills persist across messages (session-scoped), unlike attachments.
 */

import { Lightning, X } from '@phosphor-icons/react';
import { useSkillStore } from '../../../stores/skillStore';

import type { FC } from 'react';

export const SkillBar: FC = () => {
	const available = useSkillStore((s) => s.available);
	const attached = useSkillStore((s) => s.attached);
	const detachSkill = useSkillStore((s) => s.detachSkill);

	const attachedSkills = available.filter((s) => attached.has(s.name));

	if (attachedSkills.length === 0) return null;

	return (
		<div className="flex gap-1.5 flex-wrap px-3 pt-1.5">
			{attachedSkills.map((skill) => (
				<span
					key={skill.name}
					className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium transition-all duration-150 hover:bg-primary/15"
					title={skill.description || skill.name}
				>
					<Lightning className="w-3 h-3 shrink-0" weight="fill" />
					<span className="truncate max-w-[120px]">{skill.name}</span>
					<button
						onClick={() => detachSkill(skill.name)}
						className="hover:bg-primary/20 rounded-full p-0.5 ml-0.5 transition-colors active:scale-90"
						tabIndex={-1}
						type="button"
					>
						<X className="w-2.5 h-2.5" weight="bold" />
					</button>
				</span>
			))}
		</div>
	);
};
