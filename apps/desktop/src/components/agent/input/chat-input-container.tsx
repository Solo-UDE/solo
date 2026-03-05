import React, { useRef, useState, useCallback, useEffect, useMemo, lazy, Suspense } from 'react';
import { Stop, PaintBrush } from '@phosphor-icons/react';

import { ContextMenu } from './context-menu';
import { ContextTracker } from './context-tracker';
import { LexicalEditor } from './lexical-editor';
import { ThinkingToggle } from './thinking-toggle';
import { AttachmentBar } from './AttachmentBar';
import { SkillBar } from './SkillBar';
import { DropZoneOverlay } from './DropZoneOverlay';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../ui/popover';

import type { LexicalEditorHandle } from './lexical-editor';
import type { FileMention, Attachment } from '../../../stores/agentStore';
import { useActiveSessionMessages } from '../../../stores/agentStore';
import { ModeSelector } from './mode-selector';
import { ModelPicker } from './model-picker';
import { SubmitButton } from './submit-button';
import { useProviderStore } from '../../../stores/provider-store';
import { useAttachmentStore } from '../../../stores/attachmentStore';
import { useWorktreeList } from '../../../stores/worktreeStore';
import { DEFAULT_MODEL_ID } from '../../../lib/constants';
import { VoiceButton } from './voice-button';

import type { Mode } from './mode-selector';

const LazySketchPopoverContent = lazy(() =>
  import('./sketch/SketchPopoverContent').then((m) => ({ default: m.SketchPopoverContent })),
);

export interface ChatInputContainerProps {
  onSubmit: (content: string, mode: 'planning' | 'fast', model: string, attachments?: Attachment[], mentions?: FileMention[]) => void;
  onLocalCommand?: (commandId: string) => void;
  onAbort?: () => void;
  isAgentRunning?: boolean;
  className?: string;
  worktreeId?: string | null;
  onWorktreeChange?: (id: string | null) => void;
  onModeChange?: (mode: Mode) => void;
  thinkingEnabled?: boolean;
  onThinkingChange?: (enabled: boolean) => void;
  planModeActive?: boolean;
  acceptModeActive?: boolean;
}

export const ChatInputContainer: React.FC<ChatInputContainerProps> = ({
  onSubmit,
  onLocalCommand,
  onAbort,
  isAgentRunning = false,
  className = '',
  worktreeId,
  onWorktreeChange,
  onModeChange,
  thinkingEnabled = false,
  onThinkingChange,
  planModeActive = false,
  acceptModeActive = false,
}) => {
  const [content, setContent] = useState('');
  // Derive initial mode from bridge state so remounted components get the right mode
  const [mode, setMode] = useState<Mode>(() => {
    if (planModeActive) return 'planning';
    if (acceptModeActive) return 'accept';
    return 'fast';
  });
  const [mentions, setMentions] = useState<FileMention[]>([]);
  const [sketchOpen, setSketchOpen] = useState(false);
  const selectedModel = useProviderStore((state) => state.selectedModel);
  const attachments = useAttachmentStore((s) => s.attachments);
  const clearAttachments = useAttachmentStore((s) => s.clear);
  const editorRef = useRef<LexicalEditorHandle>(null);
  const voiceSuggestionDismissedRef = useRef(false);
  const [showVoiceSuggestion, setShowVoiceSuggestion] = useState(false);
  const worktrees = useWorktreeList();
  const sessionMessages = useActiveSessionMessages();

  // Sync mode from bridge state changes (plan mode / accept mode)
  useEffect(() => {
    if (planModeActive) {
      setMode('planning');
    } else if (acceptModeActive) {
      setMode('accept');
    } else {
      setMode('fast');
    }
  }, [planModeActive, acceptModeActive]);

  // Build context from recent chat messages for STT transcription improvement
  const voiceContext = useMemo(() => {
    const recent = sessionMessages.slice(-5);
    if (recent.length === 0) return undefined;
    return recent
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n')
      .slice(0, 2000);
  }, [sessionMessages]);

  // Map 3-state mode to message mode (accept sends as 'fast')
  const messageMode = mode === 'planning' ? 'planning' : 'fast';

  const handleSubmit = (): void => {
    const hasContent = content.trim() || attachments.length > 0;
    if (hasContent && !isAgentRunning) {
      onSubmit(
        content,
        messageMode,
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
    onSubmit(commandText, messageMode, selectedModel || DEFAULT_MODEL_ID);
  };

  // Cycle mode: fast → planning → accept → fast
  const cycleMode = useCallback(() => {
    const order: Mode[] = ['fast', 'planning', 'accept'];
    const nextMode = order[(order.indexOf(mode) + 1) % order.length];
    setMode(nextMode);
    onModeChange?.(nextMode);
  }, [mode, onModeChange]);

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
    // Shift+Tab cycles mode (fast → planning → accept)
    if (event.key === 'Tab' && event.shiftKey) {
      event.preventDefault();
      cycleMode();
    }
  };

  const handleModeChange = (newMode: Mode) => {
    setMode(newMode);
    onModeChange?.(newMode);
  };

  // Voice input handler: focus editor then insert transcribed text
  const handleVoiceTranscript = useCallback((text: string) => {
    console.log('[ChatInput] Voice transcript received, inserting:', text);
    voiceSuggestionDismissedRef.current = true;
    setShowVoiceSuggestion(false);
    editorRef.current?.focus();
    editorRef.current?.insertText(text + ' ');
    setContent((prev) => prev + text + ' ');
  }, []);

  // Show voice suggestion chip when user types 20+ words
  useEffect(() => {
    if (voiceSuggestionDismissedRef.current || isAgentRunning) {
      setShowVoiceSuggestion(false);
      return;
    }
    const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
    setShowVoiceSuggestion(wordCount >= 20);
  }, [content, isAgentRunning]);

  const handleDismissVoiceSuggestion = useCallback(() => {
    voiceSuggestionDismissedRef.current = true;
    setShowVoiceSuggestion(false);
  }, []);

  // Only show the selector when there are linked worktrees (more than just main)
  const showWorktreeSelector = onWorktreeChange && worktrees.length > 1;

  return (
    <div className={`bg-background ${className}`}>
      <div className="max-w-3xl mx-auto px-3 pb-3 pt-1.5">
        {/* Floating card wrapping editor + toolbar */}
        <div className="bg-card/95 backdrop-blur-md rounded-[16px] shadow-[0_4px_24px_-4px_rgba(0,0,0,0.15)] ring-1 ring-white/[0.06]">
          {/* Attachment chips/thumbnails — above editor (like Conductor) */}
          <AttachmentBar />

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
              mode={messageMode}
            />
          </DropZoneOverlay>

          {/* Attached skill chips */}
          <SkillBar />

          {/* Bottom Controls */}
          <div className="flex items-center justify-between px-3 pb-3 pt-1" style={{ fontFamily: 'var(--font-sans)' }}>
            <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
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
                  className="h-[30px] px-2.5 text-xs font-medium rounded-[8px] bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/30 transition-[transform,background-color,color] duration-200 disabled:opacity-50 disabled:cursor-not-allowed max-w-[120px] truncate"
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

            <div className="flex items-center gap-1 shrink-0">
              {/* Voice input (ElevenLabs STT) */}
              <VoiceButton
                disabled={isAgentRunning}
                onTranscript={handleVoiceTranscript}
                showSuggestion={showVoiceSuggestion}
                onSuggestionDismiss={handleDismissVoiceSuggestion}
                previousText={voiceContext}
                chatContext={voiceContext}
              />

              {/* Screen record (mock) */}
              <button
                type="button"
                className="inline-flex items-center justify-center h-[30px] w-[30px] rounded-[8px] text-muted-foreground hover:bg-muted/60 hover:text-foreground active:scale-95 transition-[transform,background-color,color] duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Screen record"
                title="Screen record"
                disabled={isAgentRunning}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256" className="h-4 w-4">
                  <path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm0-160a72,72,0,1,0,72,72A72.08,72.08,0,0,0,128,56Zm0,128a56,56,0,1,1,56-56A56.06,56.06,0,0,1,128,184Z" />
                </svg>
              </button>

              {/* Sketch canvas */}
              <Popover open={sketchOpen} onOpenChange={setSketchOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center h-[30px] w-[30px] rounded-[8px] text-muted-foreground hover:bg-muted/60 hover:text-foreground active:scale-95 transition-[transform,background-color,color] duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label="Sketch"
                    title="Sketch"
                    disabled={isAgentRunning}
                  >
                    <PaintBrush size={16} />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="end"
                  sideOffset={8}
                  className="w-auto p-0 bg-card/95 backdrop-blur-md border border-border/50 rounded-lg shadow-glass"
                >
                  <Suspense fallback={<div className="w-[640px] h-[440px] flex items-center justify-center text-muted-foreground text-sm">Loading canvas...</div>}>
                    <LazySketchPopoverContent onClose={() => setSketchOpen(false)} />
                  </Suspense>
                </PopoverContent>
              </Popover>

              {/* Submit / Stop */}
              {isAgentRunning ? (
                <button
                  onClick={onAbort}
                  className="inline-flex items-center justify-center h-[30px] w-[30px] rounded-[8px] bg-destructive text-white shadow-[0_0_8px_-2px] shadow-destructive/40 hover:brightness-110 hover:scale-105 active:scale-95 transition-[transform,background-color,filter] duration-200"
                  aria-label="Stop generation"
                >
                  <Stop weight="fill" className="h-3.5 w-3.5" />
                </button>
              ) : (
                <SubmitButton
                  onClick={handleSubmit}
                  disabled={!content.trim()}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
