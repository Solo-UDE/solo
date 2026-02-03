/**
 * MentionPlugin - Lexical plugin that detects '@' trigger and shows file search dropdown
 */

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
	$createTextNode,
	$getSelection,
	$isRangeSelection,
	$isTextNode,
	COMMAND_PRIORITY_HIGH,
	KEY_ARROW_DOWN_COMMAND,
	KEY_ARROW_UP_COMMAND,
	KEY_ENTER_COMMAND,
	KEY_ESCAPE_COMMAND,
	KEY_TAB_COMMAND,
} from 'lexical';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { fuzzySearchFiles } from '../../../../lib/fuzzySearch';
import { useWorkspaceFiles } from '../../../../hooks/useWorkspaceFiles';
import { useAttachmentStore } from '../../../../stores/attachmentStore';
import { $createMentionNode } from './MentionNode';
import { MentionDropdown } from './MentionDropdown';

import type { FileSearchResult } from '../../../../lib/fuzzySearch';
import type { FC } from 'react';

interface MentionMatch {
	/** The start offset of '@' in the text node */
	start: number;
	/** The query text after '@' */
	query: string;
}

/**
 * Get the current mention match from the editor selection.
 * Returns null if the cursor is not in a valid @-mention context.
 */
function getMentionMatch(textContent: string, offset: number): MentionMatch | null {
	// Walk backwards from cursor to find '@'
	let i = offset - 1;
	while (i >= 0) {
		const char = textContent[i];
		if (char === '@') {
			// Found the trigger - check it's at start of text or preceded by whitespace
			if (i === 0 || /\s/.test(textContent[i - 1])) {
				return {
					start: i,
					query: textContent.slice(i + 1, offset),
				};
			}
			return null;
		}
		// Stop if we hit whitespace (no @ found before space)
		if (/\s/.test(char)) {
			return null;
		}
		i--;
	}
	return null;
}

/**
 * Get cursor position in the DOM for dropdown placement.
 */
function getCursorPosition(): { top: number; left: number } | null {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) return null;

	const range = selection.getRangeAt(0);
	const rect = range.getBoundingClientRect();

	return {
		top: rect.bottom + 4,
		left: rect.left,
	};
}

export const MentionPlugin: FC = () => {
	const [editor] = useLexicalComposerContext();
	const { files } = useWorkspaceFiles();
	const addMention = useAttachmentStore((s) => s.addMention);

	const [isOpen, setIsOpen] = useState(false);
	const [query, setQuery] = useState('');
	const [match, setMatch] = useState<MentionMatch | null>(null);
	const [position, setPosition] = useState({ top: 0, left: 0 });
	const [selectedIndex, setSelectedIndex] = useState(0);

	const results = useMemo(() => fuzzySearchFiles(query, files), [query, files]);

	// Listen for editor updates to detect @ trigger
	useEffect(() => {
		return editor.registerUpdateListener(({ editorState }) => {
			editorState.read(() => {
				const selection = $getSelection();
				if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
					setIsOpen(false);
					return;
				}

				const anchor = selection.anchor;
				const node = anchor.getNode();

				if (!$isTextNode(node)) {
					setIsOpen(false);
					return;
				}

				const textContent = node.getTextContent();
				const offset = anchor.offset;
				const mentionMatch = getMentionMatch(textContent, offset);

				if (mentionMatch) {
					setMatch(mentionMatch);
					setQuery(mentionMatch.query);
					setSelectedIndex(0);

					const cursorPos = getCursorPosition();
					if (cursorPos) {
						setPosition(cursorPos);
					}
					setIsOpen(true);
				} else {
					setIsOpen(false);
					setMatch(null);
				}
			});
		});
	}, [editor]);

	// Handle selection of a file from the dropdown
	const handleSelect = useCallback(
		(result: FileSearchResult) => {
			editor.update(() => {
				const selection = $getSelection();
				if (!$isRangeSelection(selection) || !match) return;

				const anchor = selection.anchor;
				const node = anchor.getNode();

				if (!$isTextNode(node)) return;

				const textContent = node.getTextContent();

				// Split the text node: text before '@', mention node, text after query
				const beforeAt = textContent.slice(0, match.start);
				const afterQuery = textContent.slice(match.start + 1 + match.query.length);

				// Replace the text content
				node.setTextContent(beforeAt);

				// Create and insert mention node after the text
				const mentionNode = $createMentionNode(
					result.path,
					result.name,
					result.relativePath
				);

				if (beforeAt.length === 0) {
					node.insertBefore(mentionNode);
					node.remove();
				} else {
					node.insertAfter(mentionNode);
				}

				// Add remaining text after mention if any
				if (afterQuery) {
					const afterNode = $createTextNode(afterQuery);
					mentionNode.insertAfter(afterNode);
					afterNode.select(0, 0);
				} else {
					// Add a space after the mention for continued typing
					const spaceNode = $createTextNode(' ');
					mentionNode.insertAfter(spaceNode);
					spaceNode.select(1, 1);
				}
			});

			// Add to attachment store
			addMention({
				path: result.path,
				name: result.name,
				relativePath: result.relativePath,
			});

			setIsOpen(false);
			setMatch(null);
		},
		[editor, match, addMention]
	);

	// Keyboard navigation when dropdown is open
	useEffect(() => {
		if (!isOpen) return;

		const removeArrowDown = editor.registerCommand(
			KEY_ARROW_DOWN_COMMAND,
			() => {
				setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
				return true;
			},
			COMMAND_PRIORITY_HIGH
		);

		const removeArrowUp = editor.registerCommand(
			KEY_ARROW_UP_COMMAND,
			() => {
				setSelectedIndex((prev) => Math.max(prev - 1, 0));
				return true;
			},
			COMMAND_PRIORITY_HIGH
		);

		const removeEnter = editor.registerCommand(
			KEY_ENTER_COMMAND,
			() => {
				if (results.length > 0 && selectedIndex < results.length) {
					handleSelect(results[selectedIndex]);
					return true;
				}
				return false;
			},
			COMMAND_PRIORITY_HIGH
		);

		const removeTab = editor.registerCommand(
			KEY_TAB_COMMAND,
			() => {
				if (results.length > 0 && selectedIndex < results.length) {
					handleSelect(results[selectedIndex]);
					return true;
				}
				return false;
			},
			COMMAND_PRIORITY_HIGH
		);

		const removeEscape = editor.registerCommand(
			KEY_ESCAPE_COMMAND,
			() => {
				setIsOpen(false);
				setMatch(null);
				return true;
			},
			COMMAND_PRIORITY_HIGH
		);

		return () => {
			removeArrowDown();
			removeArrowUp();
			removeEnter();
			removeTab();
			removeEscape();
		};
	}, [editor, isOpen, results, selectedIndex, handleSelect]);

	if (!isOpen) return null;

	return createPortal(
		<MentionDropdown
			results={results}
			selectedIndex={selectedIndex}
			onSelect={handleSelect}
			position={position}
		/>,
		document.body
	);
};
