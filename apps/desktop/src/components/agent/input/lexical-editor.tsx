import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import { $getRoot, $getSelection, $isRangeSelection, $isElementNode, $createParagraphNode } from 'lexical';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

import { MentionNode, $isMentionNode } from './lexical/MentionNode';
import { MentionPlugin } from './lexical/MentionPlugin';
import { SlashCommandPlugin } from './lexical/SlashCommandPlugin';

import type { EditorState, LexicalEditor as LexicalEditorType } from 'lexical';
import type { FileMention } from '../../../stores/agentStore';

export interface LexicalEditorHandle {
	focus: () => void;
	insertText: (text: string) => void;
	clear: () => void;
}

export interface LexicalEditorProps {
	onChange: (value: string) => void;
	onMentionsChange?: (mentions: FileMention[]) => void;
	onKeyDown?: (event: React.KeyboardEvent) => void;
	onLocalCommand?: (commandId: string) => void;
	onAgentCommand?: (commandText: string) => void;
	placeholder?: string;
	disabled?: boolean;
	mode?: 'planning' | 'fast';
	className?: string;
}

function OnChangePluginWrapper({
	onChange,
	onMentionsChange,
}: {
	onChange: (value: string) => void;
	onMentionsChange?: (mentions: FileMention[]) => void;
}): React.JSX.Element {
	const handleChange = (editorState: EditorState): void => {
		editorState.read(() => {
			const root = $getRoot();
			const text = root.getTextContent();
			onChange(text);

			// Extract mentions from editor state
			if (onMentionsChange) {
				const mentions: FileMention[] = [];
				const allNodes = root.getChildren();
				for (const paragraph of allNodes) {
					if ($isElementNode(paragraph)) {
						const children = paragraph.getChildren();
						for (const child of children) {
							if ($isMentionNode(child)) {
								mentions.push({
									path: child.getFilePath(),
									name: child.getFileName(),
									relativePath: child.getRelativePath(),
								});
							}
						}
					}
				}
				onMentionsChange(mentions);
			}
		});
	};

	return <OnChangePlugin onChange={handleChange} />;
}

function KeyDownPlugin({ onKeyDown }: { onKeyDown?: (event: React.KeyboardEvent) => void }): null {
	const [editor] = useLexicalComposerContext();

	useEffect(() => {
		if (!onKeyDown) return;

		return editor.registerRootListener((rootElement, prevRootElement) => {
			const handler = onKeyDown as unknown as (this: HTMLElement, ev: KeyboardEvent) => void;
			if (prevRootElement !== null) {
				prevRootElement.removeEventListener('keydown', handler);
			}
			if (rootElement !== null) {
				rootElement.addEventListener('keydown', handler);
			}
		});
	}, [editor, onKeyDown]);

	return null;
}

/**
 * Inner component that has access to useLexicalComposerContext
 * and exposes imperative methods via forwardRef.
 */
function EditorRefPlugin({
	editorRef,
}: {
	editorRef: React.MutableRefObject<LexicalEditorType | null>;
}): null {
	const [editor] = useLexicalComposerContext();

	useEffect(() => {
		editorRef.current = editor;
	}, [editor, editorRef]);

	return null;
}

export const LexicalEditor = forwardRef<LexicalEditorHandle, LexicalEditorProps>(
	function LexicalEditor(
		{
			onChange,
			onMentionsChange,
			onKeyDown,
			onLocalCommand,
			onAgentCommand,
			placeholder = 'Type something...',
			disabled = false,
			mode,
			className = '',
		},
		ref
	) {
		const editorInstanceRef = useRef<LexicalEditorType | null>(null);

		useImperativeHandle(ref, () => ({
			focus: () => {
				editorInstanceRef.current?.focus();
			},
			insertText: (text: string) => {
				const editor = editorInstanceRef.current;
				if (!editor) return;
				editor.focus();
				editor.update(() => {
					const selection = $getSelection();
					if ($isRangeSelection(selection)) {
						selection.insertText(text);
					}
				});
			},
			clear: () => {
				const editor = editorInstanceRef.current;
				if (!editor) return;
				editor.update(() => {
					const root = $getRoot();
					root.clear();
					const paragraph = $createParagraphNode();
					root.append(paragraph);
					paragraph.select();
				});
			},
		}));

		const initialConfig = {
			namespace: 'ChatInput',
			theme: {
				paragraph: 'mb-1',
				text: {
					bold: 'font-bold',
					italic: 'italic',
					underline: 'underline',
				},
			},
			nodes: [MentionNode],
			onError: (error: Error) => {
				console.error('Lexical error:', error);
			},
			editable: !disabled,
		};

		const borderClass = mode === 'planning'
			? 'border-dashed border-primary/50'
			: 'border-border';

		return (
			<div className={`relative ${className}`}>
				<LexicalComposer initialConfig={initialConfig}>
					<div className="relative">
						<PlainTextPlugin
							contentEditable={
								<ContentEditable
									className={`
										min-h-[80px] max-h-[200px] overflow-y-auto
										px-4 py-3 rounded-lg border
										focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent
										${borderClass}
										${disabled ? 'bg-muted cursor-not-allowed' : 'bg-background'}
									`}
								/>
							}
							placeholder={
								<div className="absolute top-3 left-4 text-muted-foreground pointer-events-none">
									{placeholder}
								</div>
							}
							ErrorBoundary={LexicalErrorBoundary}
						/>
						<HistoryPlugin />
						<OnChangePluginWrapper onChange={onChange} onMentionsChange={onMentionsChange} />
						{onKeyDown ? <KeyDownPlugin onKeyDown={onKeyDown} /> : null}
						<EditorRefPlugin editorRef={editorInstanceRef} />
						<MentionPlugin />
						<SlashCommandPlugin
							onLocalCommand={onLocalCommand}
							onAgentCommand={onAgentCommand}
						/>
					</div>
				</LexicalComposer>
			</div>
		);
	}
);
