import React, { useRef, useState } from 'react';

import { ContextMenu } from './context-menu';
import { ContextTracker } from './context-tracker';
import { LexicalEditor } from './lexical-editor';
import { AttachmentBar } from './AttachmentBar';
import { DropZoneOverlay } from './DropZoneOverlay';

import type { LexicalEditorHandle } from './lexical-editor';
import type { FileMention, Attachment } from '../../../stores/agentStore';
import { ModeSelector } from './mode-selector';
import { ModelPicker } from './model-picker';
import { SubmitButton } from './submit-button';
import { useProviderStore } from '../../../stores/provider-store';
import { useAttachmentStore } from '../../../stores/attachmentStore';
import { useWorktreeList } from '../../../stores/worktreeStore';
import { DEFAULT_MODEL_ID } from '../../../lib/constants';

export interface ChatInputContainerProps {
  onSubmit: (content: string, mode: 'planning' | 'fast', model: string, attachments?: Attachment[], mentions?: FileMention[]) => void;
  onLocalCommand?: (commandId: string) => void;
  isAgentRunning?: boolean;
  className?: string;
  worktreeId?: string | null;
  onWorktreeChange?: (id: string | null) => void;
}

export const ChatInputContainer: React.FC<ChatInputContainerProps> = ({
  onSubmit,
  onLocalCommand,
  isAgentRunning = false,
  className = '',
  worktreeId,
  onWorktreeChange,
}) => {
  const [content, setContent] = useState('');
  const [mode, setMode] = useState<'planning' | 'fast'>('planning');
  const [mentions, setMentions] = useState<FileMention[]>([]);
  const selectedModel = useProviderStore((state) => state.selectedModel);
  const attachments = useAttachmentStore((s) => s.attachments);
  const clearAttachments = useAttachmentStore((s) => s.clear);
  const editorRef = useRef<LexicalEditorHandle>(null);
  const worktrees = useWorktreeList();

  const handleSubmit = (): void => {
    const hasContent = content.trim() || attachments.length > 0;
    if (hasContent && !isAgentRunning) {
      onSubmit(
        content,
        mode,
        selectedModel || DEFAULT_MODEL_ID,
        attachments.length > 0 ? [...attachments] : undefined,
        mentions.length > 0 ? [...mentions] : undefined,
      );
      setContent('');
      setMentions([]);
      clearAttachments();
      editorRef.current?.clear();
    }
  };

  const handleAgentCommand = (commandText: string): void => {
    onSubmit(commandText, mode, selectedModel || DEFAULT_MODEL_ID);
  };

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  // Only show the selector when there are linked worktrees (more than just main)
  const showWorktreeSelector = onWorktreeChange && worktrees.length > 1;

  return (
    <div className={`bg-background ${className}`}>
      <div className="max-w-4xl mx-auto px-4 pb-4 pt-2">
        {/* Floating card wrapping editor + toolbar */}
        <div className="bg-card/95 backdrop-blur-md rounded-[16px] shadow-[0_4px_24px_-4px_rgba(0,0,0,0.15)] ring-1 ring-white/[0.06]">
          {/* Editor with drop zone */}
          <DropZoneOverlay disabled={isAgentRunning}>
            <LexicalEditor
              ref={editorRef}
              onChange={setContent}
              onKeyDown={handleKeyDown}
              onMentionsChange={setMentions}
              onLocalCommand={onLocalCommand}
              onAgentCommand={handleAgentCommand}
              placeholder="Ask anything, @ for context"
              disabled={isAgentRunning}
              mode={mode}
            />
          </DropZoneOverlay>

          {/* Attachment chips/thumbnails */}
          <AttachmentBar />

          {/* Bottom Controls */}
          <div className="flex items-center justify-between px-3 pb-3 pt-1">
            <div className="flex items-center gap-1.5">
              <ContextMenu disabled={isAgentRunning} />
              <ModeSelector value={mode} onChange={setMode} disabled={isAgentRunning} />
              <ModelPicker side="top" disabled={isAgentRunning} />
              <ContextTracker disabled={isAgentRunning} />

              {showWorktreeSelector && (
                <select
                  value={worktreeId ?? ''}
                  onChange={(e) => onWorktreeChange(e.target.value || null)}
                  disabled={isAgentRunning}
                  className="h-[30px] px-2.5 text-xs font-medium rounded-[8px] bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/30 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Worktree"
                >
                  <option value="">Main workspace</option>
                  {worktrees.filter((wt) => !wt.is_main).map((wt) => (
                    <option key={wt.id} value={wt.id}>
                      {wt.branch ?? wt.id}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <SubmitButton
              onClick={handleSubmit}
              disabled={isAgentRunning || !content.trim()}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
