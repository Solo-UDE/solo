/**
 * MentionChip - Inline pill rendered by MentionNode.decorate()
 */

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getNodeByKey } from 'lexical';
import { At, X } from '@phosphor-icons/react';

import type { FC } from 'react';

export interface MentionChipProps {
	fileName: string;
	relativePath: string;
	nodeKey: string;
}

export const MentionChip: FC<MentionChipProps> = ({ fileName, relativePath, nodeKey }) => {
	const [editor] = useLexicalComposerContext();

	const handleRemove = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		editor.update(() => {
			const node = $getNodeByKey(nodeKey);
			if (node) {
				node.remove();
			}
		});
	};

	return (
		<span
			className="inline-flex items-center gap-0.5 px-1.5 py-0.5 mx-0.5 rounded bg-primary/15 text-primary text-xs font-medium cursor-default select-none"
			title={relativePath}
			contentEditable={false}
		>
			<At className="w-3 h-3 shrink-0" weight="bold" />
			<span className="truncate max-w-[120px]">{fileName}</span>
			<button
				onClick={handleRemove}
				className="hover:bg-primary/20 rounded-full p-0.5 ml-0.5 transition-colors"
				tabIndex={-1}
				type="button"
			>
				<X className="w-2.5 h-2.5" weight="bold" />
			</button>
		</span>
	);
};
