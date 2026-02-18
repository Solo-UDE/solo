import React, { useRef, useState } from 'react';

import { ContextMenu } from './context-menu';
import { ContextTracker } from './context-tracker';
import { LexicalEditor } from './lexical-editor';
import { ThinkingToggle } from './thinking-toggle';

import type { LexicalEditorHandle } from './lexical-editor';
import { ModeSelector } from './mode-selector';
import { ModelPicker } from './model-picker';
import { SubmitButton } from './submit-button';
import { useProviderStore } from '../../../stores/provider-store';
import { useWorktreeList } from '../../../stores/worktreeStore';
import { DEFAULT_MODEL_ID } from '../../../lib/constants';

export interface ChatInputContainerProps {
  onSubmit: (content: string, mode: 'planning' | 'fast', model: string) => void;
  isAgentRunning?: boolean;
  className?: string;
  worktreeId?: string | null;
  onWorktreeChange?: (id: string | null) => void;
  onModeChange?: (mode: 'planning' | 'fast') => void;
  thinkingEnabled?: boolean;
  onThinkingChange?: (enabled: boolean) => void;
}

export const ChatInputContainer: React.FC<ChatInputContainerProps> = ({
  onSubmit,
  isAgentRunning = false,
  className = '',
  worktreeId,
  onWorktreeChange,
  onModeChange,
  thinkingEnabled = false,
  onThinkingChange,
}) => {
  const [content, setContent] = useState('');
  const [mode, setMode] = useState<'planning' | 'fast'>('planning');
  const selectedModel = useProviderStore((state) => state.selectedModel);
  const editorRef = useRef<LexicalEditorHandle>(null);
  const worktrees = useWorktreeList();

  const handleSubmit = (): void => {
    if (content.trim() && !isAgentRunning) {
      onSubmit(content, mode, selectedModel || DEFAULT_MODEL_ID);
      setContent('');
      editorRef.current?.clear();
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  const handleModeChange = (newMode: 'planning' | 'fast') => {
    setMode(newMode);
    onModeChange?.(newMode);
  };

  // Only show the selector when there are linked worktrees (more than just main)
  const showWorktreeSelector = onWorktreeChange && worktrees.length > 1;

  return (
    <div className={`border-t border-border bg-background ${className}`}>
      <div className="max-w-4xl mx-auto p-4">
        {/* Editor */}
        <div className="mb-3">
          <LexicalEditor
            ref={editorRef}
            onChange={setContent}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything, @ for context"
            disabled={isAgentRunning}
          />
        </div>

        {/* Bottom Controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ContextMenu disabled={isAgentRunning} />
            <ModeSelector value={mode} onChange={handleModeChange} disabled={isAgentRunning} />
            <ModelPicker side="top" disabled={isAgentRunning} />
            <ThinkingToggle
              enabled={thinkingEnabled}
              onChange={(enabled) => onThinkingChange?.(enabled)}
              disabled={isAgentRunning}
            />
            <ContextTracker disabled={isAgentRunning} />

            {showWorktreeSelector && (
              <select
                value={worktreeId ?? ''}
                onChange={(e) => onWorktreeChange(e.target.value || null)}
                disabled={isAgentRunning}
                className="h-7 px-2 text-xs rounded bg-muted/50 border border-border/50 text-foreground disabled:opacity-50 outline-none focus:ring-1 focus:ring-ring"
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
  );
};
