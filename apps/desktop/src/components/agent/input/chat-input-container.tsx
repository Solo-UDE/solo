import React, { useCallback, useRef, useState } from 'react';

import { AttachmentBar } from './AttachmentBar';
import { ContextMenu } from './context-menu';
import { DropZoneOverlay } from './DropZoneOverlay';
import { LexicalEditor } from './lexical-editor';
import { ModeSelector } from './mode-selector';
import { ModelPicker } from './model-picker';
import { SubmitButton } from './submit-button';
import { useProviderStore } from '../../../stores/provider-store';
import { useAttachmentStore } from '../../../stores/attachmentStore';

import type { LexicalEditorHandle } from './lexical-editor';
import type { Attachment, FileMention } from '../../../stores/agentStore';

export interface ChatInputContainerProps {
	onSubmit: (
		content: string,
		mode: 'planning' | 'fast',
		model: string,
		attachments?: Attachment[],
		mentions?: FileMention[]
	) => void;
	onLocalCommand?: (commandId: string) => void;
	isAgentRunning?: boolean;
	className?: string;
}

export const ChatInputContainer: React.FC<ChatInputContainerProps> = ({
	onSubmit,
	onLocalCommand,
	isAgentRunning = false,
	className = '',
}) => {
	const [content, setContent] = useState('');
	const [mode, setMode] = useState<'planning' | 'fast'>('planning');
	const [mentions, setMentions] = useState<FileMention[]>([]);
	const editorRef = useRef<LexicalEditorHandle>(null);
	const selectedModel = useProviderStore((state) => state.selectedModel);
	const attachments = useAttachmentStore((s) => s.attachments);
	const clearAttachmentStore = useAttachmentStore((s) => s.clear);

	const handleSubmit = useCallback((): void => {
		const hasContent = content.trim();
		const hasAttachments = attachments.length > 0;

		if ((hasContent || hasAttachments) && !isAgentRunning) {
			onSubmit(
				content,
				mode,
				selectedModel || 'claude-sonnet-4-5-20250514',
				attachments.length > 0 ? [...attachments] : undefined,
				mentions.length > 0 ? [...mentions] : undefined
			);
			setContent('');
			setMentions([]);
			clearAttachmentStore();
			editorRef.current?.clear();
		}
	}, [content, attachments, mentions, isAgentRunning, onSubmit, mode, selectedModel, clearAttachmentStore]);

	const handleKeyDown = useCallback(
		(event: React.KeyboardEvent): void => {
			if (event.key === 'Enter' && !event.shiftKey) {
				event.preventDefault();
				handleSubmit();
			}
		},
		[handleSubmit]
	);

	const handleAgentCommand = useCallback(
		(commandText: string) => {
			onSubmit(
				commandText,
				mode,
				selectedModel || 'claude-sonnet-4-5-20250514'
			);
		},
		[onSubmit, mode, selectedModel]
	);

	const hasContent = content.trim() || attachments.length > 0;

	return (
		<div className={`border-t border-border bg-background ${className}`}>
			<div className="max-w-4xl mx-auto p-4">
				{/* Editor with drop zone */}
				<div className="mb-3">
					<DropZoneOverlay disabled={isAgentRunning}>
						<LexicalEditor
							ref={editorRef}
							onChange={setContent}
							onMentionsChange={setMentions}
							onKeyDown={handleKeyDown}
							onLocalCommand={onLocalCommand}
							onAgentCommand={handleAgentCommand}
							placeholder="Ask anything, @ for context, / for commands"
							disabled={isAgentRunning}
							mode={mode}
						/>
					</DropZoneOverlay>
				</div>

				{/* Attachment bar (thumbnails + chips) */}
				<AttachmentBar />

				{/* Bottom Controls */}
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<ContextMenu
							disabled={isAgentRunning}
						/>
						<ModeSelector value={mode} onChange={setMode} disabled={isAgentRunning} />
						<ModelPicker side="top" disabled={isAgentRunning} />
					</div>

					<SubmitButton
						onClick={handleSubmit}
						disabled={isAgentRunning || !hasContent}
					/>
				</div>
			</div>
		</div>
	);
};
