/**
 * SkillChip — the visual pill rendered by SkillChipNode.decorate().
 *
 * Mirrors MentionChip's styling conventions but uses the skill-color
 * (primary green) to distinguish from @-mentions. `×` removes the chip.
 */

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getNodeByKey } from 'lexical';
import { Cross2Icon } from '@radix-ui/react-icons';
import { Zap } from 'lucide-react';

import type { FC, MouseEvent } from 'react';

export interface SkillChipProps {
	skillName: string;
	description?: string;
	nodeKey: string;
}

export const SkillChip: FC<SkillChipProps> = ({ skillName, description, nodeKey }) => {
	const [editor] = useLexicalComposerContext();

	const handleRemove = (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		editor.update(() => {
			const node = $getNodeByKey(nodeKey);
			if (node) node.remove();
		});
	};

	return (
		<span
			className="inline-flex items-center gap-0.5 px-1.5 py-0.5 mx-0.5 rounded bg-primary/15 text-primary text-xs font-medium cursor-default select-none align-middle"
			title={description ? `/${skillName} — ${description}` : `/${skillName}`}
			contentEditable={false}
		>
			<Zap className="w-3 h-3 shrink-0" />
			<span className="truncate max-w-[160px]">/{skillName}</span>
			<button
				onClick={handleRemove}
				className="hover:bg-primary/20 rounded-full p-0.5 ml-0.5 transition-colors"
				tabIndex={-1}
				type="button"
				aria-label={`Remove ${skillName} skill`}
			>
				<Cross2Icon width={10} height={10} />
			</button>
		</span>
	);
};
