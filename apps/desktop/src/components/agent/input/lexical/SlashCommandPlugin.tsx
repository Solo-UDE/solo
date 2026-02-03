/**
 * SlashCommandPlugin - Lexical plugin that detects '/' at line start and shows command palette
 */

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
	$getRoot,
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
import {
	Brain,
	DollarSign,
	Eye,
	FileText,
	FolderPlus,
	GitBranch,
	Keyboard,
	Lock,
	MessageSquare,
	Minimize2,
	Puzzle,
	Search,
	Server,
	Shield,
	Trash2,
	Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { SlashCommandDropdown } from './SlashCommandDropdown';

import type { SlashCommand } from './SlashCommandDropdown';
import type { FC } from 'react';

const SLASH_COMMANDS: SlashCommand[] = [
	// Local commands (UI actions)
	{ id: 'clear', label: '/clear', description: 'Close tab and start fresh chat', category: 'local', icon: Trash2 },
	{ id: 'keybindings-help', label: '/keybindings-help', description: 'Customize keyboard shortcuts', category: 'local', icon: Keyboard },
	{ id: 'mcp-status', label: '/mcp-status', description: 'View MCP server connection status', category: 'local', icon: Server },
	{ id: 'mcp', label: '/mcp', description: 'Manage MCP servers', category: 'local', icon: Server },
	{ id: 'agents', label: '/agents', description: 'Manage agents', category: 'local', icon: Users },
	{ id: 'hooks', label: '/hooks', description: 'Manage hooks', category: 'local', icon: GitBranch },
	{ id: 'memory', label: '/memory', description: 'Manage memory', category: 'local', icon: Brain },
	{ id: 'permissions', label: '/permissions', description: 'Manage permissions', category: 'local', icon: Lock },
	{ id: 'plugins', label: '/plugins', description: 'Manage plugins', category: 'local', icon: Puzzle },
	// Agent commands (sent as message)
	{ id: 'compact', label: '/compact', description: 'Clear history but keep summary in context', category: 'agent', icon: Minimize2 },
	{ id: 'context', label: '/context', description: 'Show current context usage', category: 'agent', icon: Eye },
	{ id: 'cost', label: '/cost', description: 'Show total cost and duration of session', category: 'agent', icon: DollarSign },
	{ id: 'init', label: '/init', description: 'Initialize CLAUDE.md with codebase docs', category: 'agent', icon: FolderPlus },
	{ id: 'pr-comments', label: '/pr-comments', description: 'Get comments from a GitHub PR', category: 'agent', icon: MessageSquare },
	{ id: 'release-notes', label: '/release-notes', description: 'View release notes', category: 'agent', icon: FileText },
	{ id: 'review', label: '/review', description: 'Review a pull request', category: 'agent', icon: Search },
	{ id: 'security-review', label: '/security-review', description: 'Security review of pending changes', category: 'agent', icon: Shield },
	{ id: 'add-dir', label: '/add-dir', description: 'Link a workspace from another repository', category: 'agent', icon: FolderPlus },
];

export interface SlashCommandPluginProps {
	onLocalCommand?: (commandId: string) => void;
	onAgentCommand?: (commandText: string) => void;
}

export const SlashCommandPlugin: FC<SlashCommandPluginProps> = ({
	onLocalCommand,
	onAgentCommand,
}) => {
	const [editor] = useLexicalComposerContext();

	const [isOpen, setIsOpen] = useState(false);
	const [query, setQuery] = useState('');
	const [position, setPosition] = useState({ bottom: 0, left: 0 });
	const [selectedIndex, setSelectedIndex] = useState(0);

	const filteredCommands = useMemo(() => {
		if (!query) return SLASH_COMMANDS;
		const lowerQuery = query.toLowerCase();
		return SLASH_COMMANDS.filter(
			(cmd) =>
				cmd.id.toLowerCase().includes(lowerQuery) ||
				cmd.description.toLowerCase().includes(lowerQuery)
		);
	}, [query]);

	// Listen for editor updates to detect / trigger
	useEffect(() => {
		return editor.registerUpdateListener(({ editorState }) => {
			let shouldOpen = false;
			let commandQuery = '';

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

				// Only trigger when the node is inside the first paragraph
				const root = $getRoot();
				const firstChild = root.getFirstChild();
				if (!firstChild || node.getParent()?.getKey() !== firstChild.getKey()) {
					setIsOpen(false);
					return;
				}

				// Get the full text content up to cursor
				const textContent = node.getTextContent();
				const offset = anchor.offset;
				const textUpToCursor = textContent.slice(0, offset);

				// Check if text starts with '/'
				if (textUpToCursor.startsWith('/')) {
					commandQuery = textUpToCursor.slice(1);
					shouldOpen = true;
				} else {
					setIsOpen(false);
				}
			});

			if (shouldOpen) {
				// Position dropdown after DOM flush, anchored to the '/' character
				requestAnimationFrame(() => {
					const sel = window.getSelection();
					if (sel && sel.rangeCount > 0) {
						const range = sel.getRangeAt(0).cloneRange();
						// Collapse to start of text node to get position of '/'
						range.setStart(range.startContainer, 0);
						range.collapse(true);
						const rect = range.getBoundingClientRect();
						setPosition({ bottom: window.innerHeight - rect.top + 4, left: rect.left });
					}
					setQuery(commandQuery);
					setSelectedIndex(0);
					setIsOpen(true);
				});
			}
		});
	}, [editor]);

	const handleSelect = useCallback(
		(command: SlashCommand) => {
			// Clear the editor content
			editor.update(() => {
				const root = $getRoot();
				root.clear();
			});

			setIsOpen(false);

			if (command.category === 'local') {
				onLocalCommand?.(command.id);
			} else {
				onAgentCommand?.(`/${command.id}`);
			}
		},
		[editor, onLocalCommand, onAgentCommand]
	);

	// Keyboard navigation
	useEffect(() => {
		if (!isOpen) return;

		const removeArrowDown = editor.registerCommand(
			KEY_ARROW_DOWN_COMMAND,
			() => {
				setSelectedIndex((prev) => Math.min(prev + 1, filteredCommands.length - 1));
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
				if (filteredCommands.length > 0 && selectedIndex < filteredCommands.length) {
					handleSelect(filteredCommands[selectedIndex]);
					return true;
				}
				return false;
			},
			COMMAND_PRIORITY_HIGH
		);

		const removeTab = editor.registerCommand(
			KEY_TAB_COMMAND,
			() => {
				if (filteredCommands.length > 0 && selectedIndex < filteredCommands.length) {
					handleSelect(filteredCommands[selectedIndex]);
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
	}, [editor, isOpen, filteredCommands, selectedIndex, handleSelect]);

	if (!isOpen) return null;

	return createPortal(
		<SlashCommandDropdown
			commands={filteredCommands}
			selectedIndex={selectedIndex}
			onSelect={handleSelect}
			position={position}
		/>,
		document.body
	);
};
