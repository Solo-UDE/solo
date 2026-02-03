/**
 * MentionNode - Custom Lexical DecoratorNode for inline @-mention pills
 */

import type { EditorConfig, LexicalNode, NodeKey, SerializedLexicalNode, Spread } from 'lexical';
import type { ReactElement } from 'react';
import { DecoratorNode } from 'lexical';
import { createElement } from 'react';
import { MentionChip } from './MentionChip';

export type SerializedMentionNode = Spread<
	{
		filePath: string;
		fileName: string;
		relativePath: string;
	},
	SerializedLexicalNode
>;

export class MentionNode extends DecoratorNode<ReactElement> {
	__filePath: string;
	__fileName: string;
	__relativePath: string;

	static getType(): string {
		return 'mention';
	}

	static clone(node: MentionNode): MentionNode {
		return new MentionNode(node.__filePath, node.__fileName, node.__relativePath, node.__key);
	}

	constructor(filePath: string, fileName: string, relativePath: string, key?: NodeKey) {
		super(key);
		this.__filePath = filePath;
		this.__fileName = fileName;
		this.__relativePath = relativePath;
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
		return createElement(MentionChip, {
			fileName: this.__fileName,
			relativePath: this.__relativePath,
			nodeKey: this.__key,
		});
	}

	isInline(): true {
		return true;
	}

	isIsolated(): true {
		return true;
	}

	getFilePath(): string {
		return this.__filePath;
	}

	getFileName(): string {
		return this.__fileName;
	}

	getRelativePath(): string {
		return this.__relativePath;
	}

	exportJSON(): SerializedMentionNode {
		return {
			...super.exportJSON(),
			type: 'mention',
			filePath: this.__filePath,
			fileName: this.__fileName,
			relativePath: this.__relativePath,
			version: 1,
		};
	}

	static importJSON(serializedNode: SerializedMentionNode): MentionNode {
		return $createMentionNode(
			serializedNode.filePath,
			serializedNode.fileName,
			serializedNode.relativePath
		);
	}
}

export function $createMentionNode(
	filePath: string,
	fileName: string,
	relativePath: string
): MentionNode {
	return new MentionNode(filePath, fileName, relativePath);
}

export function $isMentionNode(node: LexicalNode | null | undefined): node is MentionNode {
	return node instanceof MentionNode;
}
