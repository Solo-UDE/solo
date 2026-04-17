/**
 * SlashCommandPlugin - detects '/' anywhere in the editor (not just at line
 * start) and shows a command palette for skills + built-in commands.
 *
 * Two flavors of entries:
 *  - SKILLS: insert an inline `SkillChipNode` at the position of the `/` trigger.
 *    Works anywhere — the `/query` span is surgically replaced with a chip,
 *    preserving text before and after. Mirrors the @-mention replacement.
 *  - LOCAL / AGENT commands (/clear, /compact, …): legacy behavior. These
 *    fire an action that replaces or dispatches the whole message, so they
 *    only make sense when the trigger is at the very start of the first
 *    paragraph. We filter them out of the dropdown otherwise.
 */

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
	$createTextNode,
	$getRoot,
	$getSelection,
	$isElementNode,
	$isRangeSelection,
	$isTextNode,
	$nodesOfType,
	COMMAND_PRIORITY_HIGH,
	KEY_ARROW_DOWN_COMMAND,
	KEY_ARROW_UP_COMMAND,
	KEY_ENTER_COMMAND,
	KEY_ESCAPE_COMMAND,
	KEY_TAB_COMMAND,
} from 'lexical';
import { EyeOpenIcon, FileTextIcon, MagnifyingGlassIcon, TrashIcon } from '@radix-ui/react-icons';
import {
	Brain,
	DollarSign,
	FolderPlus,
	GitBranch,
	Keyboard,
	Lock,
	MessageCircle,
	Minimize2,
	Puzzle,
	HardDrive,
	ShieldCheck,
	Users,
	Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { SlashCommandDropdown } from './SlashCommandDropdown';
import { $createSkillChipNode, SkillChipNode } from './SkillChipNode';
import { useSkillStore } from '../../../../stores/skillStore';
import { useFileExplorerStore } from '../../../../stores/fileExplorerStore';

import type { SlashCommand } from './SlashCommandDropdown';
import type { FC } from 'react';

const SLASH_COMMANDS: SlashCommand[] = [
	// Local commands (UI actions)
	{ id: 'clear', label: '/clear', description: 'Close tab and start fresh chat', category: 'local', icon: TrashIcon },
	{ id: 'keybindings-help', label: '/keybindings-help', description: 'Customize keyboard shortcuts', category: 'local', icon: Keyboard },
	{ id: 'mcp-status', label: '/mcp-status', description: 'View MCP server connection status', category: 'local', icon: HardDrive },
	{ id: 'mcp', label: '/mcp', description: 'Manage MCP servers', category: 'local', icon: HardDrive },
	{ id: 'agents', label: '/agents', description: 'Manage agents', category: 'local', icon: Users },
	{ id: 'hooks', label: '/hooks', description: 'Manage hooks', category: 'local', icon: GitBranch },
	{ id: 'memory', label: '/memory', description: 'Manage memory', category: 'local', icon: Brain },
	{ id: 'permissions', label: '/permissions', description: 'Manage permissions', category: 'local', icon: Lock },
	{ id: 'plugins', label: '/plugins', description: 'Manage plugins', category: 'local', icon: Puzzle },
	// Agent commands (sent as message)
	{ id: 'compact', label: '/compact', description: 'Clear history but keep summary in context', category: 'agent', icon: Minimize2 },
	{ id: 'context', label: '/context', description: 'Show current context usage', category: 'agent', icon: EyeOpenIcon },
	{ id: 'cost', label: '/cost', description: 'Show total cost and duration of session', category: 'agent', icon: DollarSign },
	{ id: 'init', label: '/init', description: 'Initialize CLAUDE.md with codebase docs', category: 'agent', icon: FolderPlus },
	{ id: 'pr-comments', label: '/pr-comments', description: 'Get comments from a GitHub PR', category: 'agent', icon: MessageCircle },
	{ id: 'release-notes', label: '/release-notes', description: 'View release notes', category: 'agent', icon: FileTextIcon },
	{ id: 'review', label: '/review', description: 'Review a pull request', category: 'agent', icon: MagnifyingGlassIcon },
	{ id: 'security-review', label: '/security-review', description: 'Security review of pending changes', category: 'agent', icon: ShieldCheck },
	{ id: 'add-dir', label: '/add-dir', description: 'Link a workspace from another repository', category: 'agent', icon: FolderPlus },
];

interface SlashMatch {
	/** Offset of the `/` character inside the anchor text node. */
	start: number;
	/** Text the user typed after `/`. */
	query: string;
	/**
	 * True iff the `/` is at the very start of the message (offset 0 in the
	 * first paragraph's first text node). Gates whether built-in /commands
	 * like /compact appear — they only make sense as whole-message actions.
	 */
	atMessageStart: boolean;
}

/**
 * Walk backwards from the cursor to find a `/` that's either at the start
 * of the text node or preceded by whitespace. Returns null if not inside a
 * slash context (e.g. the user typed `foo/bar` — that's not a trigger).
 */
function getSlashMatch(textContent: string, offset: number): { start: number; query: string } | null {
	let i = offset - 1;
	while (i >= 0) {
		const ch = textContent[i];
		if (ch === '/') {
			if (i === 0 || /\s/.test(textContent[i - 1])) {
				return { start: i, query: textContent.slice(i + 1, offset) };
			}
			return null;
		}
		if (/\s/.test(ch)) return null;
		i--;
	}
	return null;
}

/** Cursor rect for dropdown anchoring — mirrors MentionPlugin. */
function getCursorPosition(): { bottom: number; left: number } | null {
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0) return null;
	const rect = sel.getRangeAt(0).getBoundingClientRect();
	return { bottom: window.innerHeight - rect.top + 4, left: rect.left };
}

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
	const [match, setMatch] = useState<SlashMatch | null>(null);
	const [position, setPosition] = useState({ bottom: 0, left: 0 });
	const [selectedIndex, setSelectedIndex] = useState(0);
	// Names of skills currently chipped into the editor — used to show the
	// "Active" indicator in the dropdown.
	const [chippedSkills, setChippedSkills] = useState<Set<string>>(new Set());

	const availableSkills = useSkillStore((s) => s.available);
	const loadSkills = useSkillStore((s) => s.loadSkills);
	const skillsLoaded = useSkillStore((s) => s.loaded);
	const rootPath = useFileExplorerStore((s) => s.rootPath);

	useEffect(() => {
		if (rootPath && !skillsLoaded) {
			loadSkills(rootPath);
		}
	}, [rootPath, skillsLoaded, loadSkills]);

	// Keep local `chippedSkills` set in sync with the editor so the dropdown
	// can mark entries already chipped.
	useEffect(() => {
		const sync = () => {
			editor.getEditorState().read(() => {
				const chips = $nodesOfType(SkillChipNode);
				setChippedSkills(new Set(chips.map((c) => c.getSkillName())));
			});
		};
		sync();
		return editor.registerUpdateListener(sync);
	}, [editor]);

	// Dropdown items: skills always available; built-in commands only when the
	// trigger is at message start. `query` field and ordering preserved.
	const allItems = useMemo(() => {
		const skillItems: SlashCommand[] = availableSkills
			.filter((s) => s.enabled)
			.map((skill) => ({
				id: `skill:${skill.name}`,
				label: skill.name,
				description: skill.description || `Skill from ${skill.source}`,
				category: 'skill' as const,
				icon: Zap,
				attached: chippedSkills.has(skill.name),
				source: skill.source,
			}));
		const base = match?.atMessageStart ? SLASH_COMMANDS : [];
		return [...base, ...skillItems];
	}, [availableSkills, chippedSkills, match?.atMessageStart]);

	const filteredCommands = useMemo(() => {
		const query = match?.query ?? '';
		if (!query) return allItems;
		const lowerQuery = query.toLowerCase();
		return allItems.filter(
			(cmd) =>
				cmd.id.toLowerCase().includes(lowerQuery) ||
				cmd.label.toLowerCase().includes(lowerQuery) ||
				cmd.description.toLowerCase().includes(lowerQuery),
		);
	}, [match?.query, allItems]);

	// Detect the `/` trigger anywhere in the editor.
	useEffect(() => {
		return editor.registerUpdateListener(({ editorState }) => {
			let nextMatch: SlashMatch | null = null;

			editorState.read(() => {
				const selection = $getSelection();
				if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;

				const anchor = selection.anchor;
				const node = anchor.getNode();
				if (!$isTextNode(node)) return;

				const textContent = node.getTextContent();
				const offset = anchor.offset;
				const raw = getSlashMatch(textContent, offset);
				if (!raw) return;

				// `atMessageStart` only when the slash is at offset 0 of the
				// first text node of the first paragraph of the root.
				const root = $getRoot();
				const firstParagraph = root.getFirstChild();
				const firstTextNode = firstParagraph && $isElementNode(firstParagraph)
					? firstParagraph.getFirstChild()
					: null;
				const atMessageStart =
					raw.start === 0 &&
					firstTextNode != null &&
					firstTextNode.getKey() === node.getKey();

				nextMatch = { start: raw.start, query: raw.query, atMessageStart };
			});

			if (nextMatch) {
				// Anchor dropdown near the cursor position after the DOM settles.
				requestAnimationFrame(() => {
					const cursorPos = getCursorPosition();
					if (cursorPos) setPosition(cursorPos);
					setMatch(nextMatch);
					setSelectedIndex(0);
					setIsOpen(true);
				});
			} else {
				setIsOpen(false);
				setMatch(null);
			}
		});
	}, [editor]);

	const handleSelect = useCallback(
		(command: SlashCommand) => {
			if (command.category === 'skill') {
				const skillName = command.id.replace('skill:', '');
				const skillMeta = availableSkills.find((s) => s.name === skillName);

				// Splice the `/query` text out of the anchor text node and insert
				// a chip exactly where the slash lived — preserving everything
				// else the user has typed before or after.
				editor.update(() => {
					const selection = $getSelection();
					if (!$isRangeSelection(selection) || !match) return;
					const anchor = selection.anchor;
					const node = anchor.getNode();
					if (!$isTextNode(node)) return;

					const textContent = node.getTextContent();
					const beforeSlash = textContent.slice(0, match.start);
					const afterQuery = textContent.slice(match.start + 1 + match.query.length);

					// Toggle: if the same skill is already chipped elsewhere in the
					// editor, just strip the `/query` text without adding a second.
					const alreadyChipped = chippedSkills.has(skillName);

					node.setTextContent(beforeSlash);

					if (alreadyChipped) {
						// Reattach trailing text as a separate node so the cursor can
						// land after it.
						if (afterQuery) {
							const after = $createTextNode(afterQuery);
							node.insertAfter(after);
							after.select(0, 0);
						}
						if (beforeSlash.length === 0) node.remove();
						return;
					}

					const chip = $createSkillChipNode(skillName, skillMeta?.description ?? '');

					if (beforeSlash.length === 0) {
						node.insertBefore(chip);
						node.remove();
					} else {
						node.insertAfter(chip);
					}

					if (afterQuery) {
						const afterNode = $createTextNode(afterQuery);
						chip.insertAfter(afterNode);
						afterNode.select(0, 0);
					} else {
						// Trailing space so the user can keep typing without the caret
						// getting stuck inside the chip.
						const spaceNode = $createTextNode(' ');
						chip.insertAfter(spaceNode);
						spaceNode.select(1, 1);
					}
				});

				setIsOpen(false);
				setMatch(null);
				return;
			}

			// Built-in /command (local or agent). These only appear in the
			// dropdown when `atMessageStart === true`, so clearing the editor
			// and dispatching is safe.
			editor.update(() => {
				$getRoot().clear();
			});
			setIsOpen(false);
			setMatch(null);

			if (command.category === 'local') {
				onLocalCommand?.(command.id);
			} else {
				onAgentCommand?.(`/${command.id}`);
			}
		},
		[editor, onLocalCommand, onAgentCommand, availableSkills, chippedSkills, match],
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
			COMMAND_PRIORITY_HIGH,
		);
		const removeArrowUp = editor.registerCommand(
			KEY_ARROW_UP_COMMAND,
			() => {
				setSelectedIndex((prev) => Math.max(prev - 1, 0));
				return true;
			},
			COMMAND_PRIORITY_HIGH,
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
			COMMAND_PRIORITY_HIGH,
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
			COMMAND_PRIORITY_HIGH,
		);
		const removeEscape = editor.registerCommand(
			KEY_ESCAPE_COMMAND,
			() => {
				setIsOpen(false);
				setMatch(null);
				return true;
			},
			COMMAND_PRIORITY_HIGH,
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
		document.body,
	);
};
