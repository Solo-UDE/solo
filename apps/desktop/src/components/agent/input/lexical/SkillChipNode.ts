/**
 * SkillChipNode — custom Lexical DecoratorNode that renders an inline skill
 * chip inside the editor (Option D UX). The skill is a first-class part of
 * the message content rather than an attachment below the input.
 *
 * Matches the pattern established by MentionNode. Text content is empty so
 * the chip doesn't leak into `root.getTextContent()` — skill names are
 * extracted separately via `$nodesOfType(SkillChipNode)` at send time.
 */

import type { EditorConfig, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from 'lexical';
import type { ReactElement } from 'react';
import { DecoratorNode } from 'lexical';
import { createElement } from 'react';

import { SkillChip } from './SkillChip';

export type SerializedSkillChipNode = Spread<
	{
		skillName: string;
		description?: string;
	},
	SerializedLexicalNode
>;

export class SkillChipNode extends DecoratorNode<ReactElement> {
	__skillName: string;
	__description: string;

	static getType(): string {
		return 'skillChip';
	}

	static clone(node: SkillChipNode): SkillChipNode {
		return new SkillChipNode(node.__skillName, node.__description, node.__key);
	}

	constructor(skillName: string, description: string = '', key?: NodeKey) {
		super(key);
		this.__skillName = skillName;
		this.__description = description;
	}

	createDOM(_config: EditorConfig): HTMLElement {
		const span = document.createElement('span');
		span.style.display = 'inline';
		return span;
	}

	updateDOM(): false {
		return false;
	}

	decorate(): ReactElement {
		return createElement(SkillChip, {
			skillName: this.__skillName,
			description: this.__description,
			nodeKey: this.__key,
		});
	}

	isInline(): true {
		return true;
	}

	isIsolated(): true {
		return true;
	}

	// Empty text — skill chips do not contribute to the message body text.
	// The agent sees the skill instructions via the content blocks built in
	// agentStore.toContentBlocks, not via the user's typed message.
	getTextContent(): string {
		return '';
	}

	getSkillName(): string {
		return this.__skillName;
	}

	getDescription(): string {
		return this.__description;
	}

	exportJSON(): SerializedSkillChipNode {
		return {
			...super.exportJSON(),
			type: 'skillChip',
			skillName: this.__skillName,
			description: this.__description,
			version: 1,
		};
	}

	static importJSON(serializedNode: SerializedSkillChipNode): SkillChipNode {
		return $createSkillChipNode(serializedNode.skillName, serializedNode.description);
	}
}

export function $createSkillChipNode(
	skillName: string,
	description: string = '',
): SkillChipNode {
	return new SkillChipNode(skillName, description);
}

export function $isSkillChipNode(node: LexicalNode | null | undefined): node is SkillChipNode {
	return node instanceof SkillChipNode;
}
