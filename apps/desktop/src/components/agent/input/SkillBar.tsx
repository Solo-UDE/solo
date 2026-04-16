/**
 * SkillBar - Displays attached skill chips below the editor.
 * Skills persist across messages (session-scoped), unlike attachments.
 */

import { Cross2Icon } from '@radix-ui/react-icons';
import { Zap } from 'lucide-react';
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
					<Zap className="w-3 h-3 shrink-0" />
					<span className="truncate max-w-[120px]">{skill.name}</span>
					<button
						onClick={() => detachSkill(skill.name)}
						className="hover:bg-primary/20 rounded-full p-0.5 ml-0.5 transition-colors active:scale-90"
						tabIndex={-1}
						type="button"
					>
						<Cross2Icon width={10} height={10} />
					</button>
				</span>
			))}
		</div>
	);
};
