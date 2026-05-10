import React, { useRef, useState, useCallback, useEffect, useMemo, useImperativeHandle, forwardRef, lazy, Suspense } from 'react';
import { StopIcon } from '@radix-ui/react-icons';
import { MessageSquare, Paintbrush, X } from 'lucide-react';

import { ContextMenu } from './context-menu';
import { ContextTracker } from './context-tracker';
import { LexicalEditor } from './lexical-editor';
import { ThinkingToggle } from './thinking-toggle';
import { AttachmentBar } from './AttachmentBar';
import { DropZoneOverlay } from './DropZoneOverlay';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select';

import type { LexicalEditorHandle } from './lexical-editor';
import type { FileMention, Attachment, UserContentPart } from '../../../stores/agentStore';
import { ModeSelector } from './mode-selector';
import { ModelPicker } from './model-picker';
import { OpenAICapabilityBanner } from './OpenAICapabilityBanner';
import { SubmitButton } from './submit-button';
import { useProviderStore } from '../../../stores/provider-store';
import { useAttachmentStore } from '../../../stores/attachmentStore';
import { useWorktreeList } from '../../../stores/worktreeStore';
import { useAgentStore } from '../../../stores/agentStore';
import { DEFAULT_MODEL_ID, MODEL_OPTIONS } from '../../../lib/constants';
import { VoiceButton } from './voice-button';
import { toolbarButtonIconOnly } from './toolbar-button-class';
import { SkillSuggestionBanner } from './SkillSuggestionBanner';
import { useSkillSuggestions } from '../../../hooks/useSkillSuggestions';
import { cn } from '../../../lib/utils';

import type { Mode } from './mode-selector';

const LazySketchPopoverContent = lazy(() =>
  import('./sketch/SketchPopoverContent').then((m) => ({ default: m.SketchPopoverContent })),
);

interface SelectionPill {
  id: string;
  text: string;
  title: string;
  preview: string;
}

const SELECTION_PREVIEW_LIMIT = 64;

function selectionPreview(text: string): string {
  const compact = text.trim().replace(/\s+/g, ' ');
  if (compact.length <= SELECTION_PREVIEW_LIMIT) return compact;
  return `${compact.slice(0, SELECTION_PREVIEW_LIMIT - 1).trimEnd()}…`;
}

function createSelectionPill(text: string): SelectionPill | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `selection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    text: trimmed,
    title: '1 selection',
    preview: selectionPreview(trimmed),
  };
}

function selectionPart(selection: SelectionPill): UserContentPart {
  return {
    type: 'selection',
    text: selection.text,
    title: selection.title,
    preview: selection.preview,
  };
}

function isSelectionPart(part: UserContentPart): part is Extract<UserContentPart, { type: 'selection' }> {
  return part.type === 'selection';
}

function selectionContext(selections: SelectionPill[]): string {
  return selections
    .map((selection, index) => `<chat-selection index="${index + 1}">\n${selection.text}\n</chat-selection>`)
    .join('\n\n');
}

function buildSubmittedContent(content: string, selections: SelectionPill[]): string {
  const blocks = [
    selections.length > 0 ? selectionContext(selections) : '',
    content.trim(),
  ].filter(Boolean);
  return blocks.join('\n\n');
}

function buildSubmittedParts(selections: SelectionPill[], editorParts: UserContentPart[]): UserContentPart[] {
  const parts = selections.map(selectionPart);
  if (parts.length > 0 && editorParts.length > 0) {
    parts.push({ type: 'text', text: '\n\n' });
  }
  parts.push(...editorParts);
  return parts;
}

function SelectionPillBar({
  selections,
  onRemove,
}: {
  selections: SelectionPill[];
  onRemove: (id: string) => void;
}) {
  if (selections.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-1 pb-1.5 pt-1">
      {selections.map((selection) => (
        <div
          key={selection.id}
          className="group flex min-w-0 max-w-[280px] items-center gap-2 rounded-[10px] border border-border/75 bg-background/72 py-2 pl-2 pr-1.5 shadow-[0_10px_24px_-22px_rgba(0,0,0,0.55)]"
          title={selection.text}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-foreground text-background">
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium leading-4 text-foreground">
              {selection.title}
            </span>
            <span className="mt-0.5 block truncate text-xs leading-4 text-muted-foreground">
              {selection.preview}
            </span>
          </span>
          <button
            type="button"
            onClick={() => onRemove(selection.id)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-[background-color,color,transform] duration-150 hover:bg-muted hover:text-foreground active:scale-[0.96]"
            aria-label="Remove selection"
            title="Remove selection"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Imperative API for the panel to invoke composer actions when focus is elsewhere (feed, buttons, etc.). */
export interface ChatInputContainerHandle {
  /** Send or enqueue whatever is in the composer right now. No-op if empty. */
  submit: () => void;
  /** Pull queued pills back into the composer and abort the running turn. Safe to call with empty queue. */
  abortWithRecall: () => void;
  /** Focus the editor. */
  focus: () => void;
  /** Insert plain text at the end of the composer. */
  insertText: (text: string) => void;
  /** Attach selected chat text as a compact pill above the editor. */
  addSelection: (text: string) => void;
}

export interface ChatInputContainerProps {
  onSubmit: (content: string, mode: 'planning' | 'fast', model: string, attachments?: Attachment[], mentions?: FileMention[], skills?: string[], parts?: UserContentPart[]) => void;
  /** Called instead of `onSubmit` when `isAgentRunning` is true — message should be queued, not sent. */
  onEnqueue?: (content: string, mode: 'planning' | 'fast', model: string, attachments?: Attachment[], mentions?: FileMention[], skills?: string[], parts?: UserContentPart[]) => void;
  /** Pops all queued messages back into the composer for editing. Returns `null` if the queue is empty. */
  onRecallQueue?: () => { text: string; mentions?: FileMention[]; skills?: string[]; parts?: UserContentPart[] } | null;
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
  debugModeActive?: boolean;
}

function ChatInputContainerInner(
  {
    onSubmit,
    onEnqueue,
    onRecallQueue,
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
    debugModeActive = false,
  }: ChatInputContainerProps,
  forwardedRef: React.ForwardedRef<ChatInputContainerHandle>,
) {
  const [content, setContent] = useState('');
  const [selectionPills, setSelectionPills] = useState<SelectionPill[]>([]);
  // Derive initial mode from bridge state so remounted components get the right mode
  const [mode, setMode] = useState<Mode>(() => {
    if (planModeActive) return 'plan';
    if (acceptModeActive) return 'accept';
    if (debugModeActive) return 'debug';
    return 'default';
  });
  const [mentions, setMentions] = useState<FileMention[]>([]);
  const [skillNames, setSkillNames] = useState<string[]>([]);
  const [sketchOpen, setSketchOpen] = useState(false);
  const selectedModel = useProviderStore((state) => state.selectedModel);
  const activeSessionId = useAgentStore((s) => s.activeSessionId);
  const showOpenAIBanner = useMemo(() => {
    const entry = MODEL_OPTIONS.find((m) => m.value === selectedModel);
    return entry?.textOnly === true;
  }, [selectedModel]);
  const attachments = useAttachmentStore((s) => s.attachments);
  const clearAttachments = useAttachmentStore((s) => s.clear);
  const editorRef = useRef<LexicalEditorHandle>(null);
  const voiceSuggestionDismissedRef = useRef(false);
  const [showVoiceSuggestion, setShowVoiceSuggestion] = useState(false);
  const worktrees = useWorktreeList();

  // Sync mode from store state changes (plan / accept / debug overlays)
  useEffect(() => {
    if (planModeActive) {
      setMode('plan');
    } else if (acceptModeActive) {
      setMode('accept');
    } else if (debugModeActive) {
      setMode('debug');
    } else {
      setMode('default');
    }
  }, [planModeActive, acceptModeActive, debugModeActive]);

  // Map the 4-state PermissionMode to the wire-level MessageMode ('planning' | 'fast')
  // used for the per-message marker. Only 'plan' flips to 'planning'; everything
  // else sends as 'fast'.
  const messageMode = mode === 'plan' ? 'planning' : 'fast';

  const handleSubmit = (): void => {
    const hasContent = content.trim() || attachments.length > 0 || skillNames.length > 0 || selectionPills.length > 0;
    if (!hasContent) return;

    const model = selectedModel || DEFAULT_MODEL_ID;
    const submittedContent = buildSubmittedContent(content, selectionPills);
    const attachmentsArg = attachments.length > 0 ? [...attachments] : undefined;
    const mentionsArg = mentions.length > 0 ? [...mentions] : undefined;
    const skillsArg = skillNames.length > 0 ? [...skillNames] : undefined;
    // Ordered parts snapshot the exact interleaving of text and chips so the
    // rendered bubble can preserve chip-in-the-middle order.
    const orderedParts = buildSubmittedParts(selectionPills, editorRef.current?.getOrderedParts() ?? []);
    const partsArg = orderedParts.length > 0 ? orderedParts : undefined;

    if (isAgentRunning) {
      // Agent is busy — queue the message instead of sending. If the parent
      // didn't wire `onEnqueue`, fall back to the legacy block (no-op).
      if (!onEnqueue) return;
      onEnqueue(submittedContent, messageMode, model, attachmentsArg, mentionsArg, skillsArg, partsArg);
    } else {
      onSubmit(submittedContent, messageMode, model, attachmentsArg, mentionsArg, skillsArg, partsArg);
    }

    setContent('');
    setSelectionPills([]);
    setMentions([]);
    setSkillNames([]);
    clearAttachments();
    editorRef.current?.clear();
  };

  const handleRecallQueue = useCallback((): boolean => {
    if (!onRecallQueue) return false;
    const recalled = onRecallQueue();
    if (!recalled) return false;
    const recalledParts = recalled.parts ?? [];
    const recalledSelections = recalledParts
      .filter(isSelectionPart)
      .map((part) => ({
        id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `selection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text: part.text,
        title: part.title ?? '1 selection',
        preview: part.preview ?? selectionPreview(part.text),
      }));
    if (recalledSelections.length > 0) {
      setSelectionPills((prev) => [...recalledSelections, ...prev]);
    }

    const recalledTextFromParts = recalledParts
      .filter((part): part is Extract<UserContentPart, { type: 'text' }> => part.type === 'text')
      .map((part) => part.text)
      .join('')
      .trim();
    const recalledText = recalledParts.length > 0 ? recalledTextFromParts : recalled.text;
    // Merge recalled text with whatever the user has already typed (current
    // content goes at the end so the cursor lands past everything).
    const merged = [recalledText, content].filter((s) => s.length > 0).join('\n\n');
    editorRef.current?.setText(merged);
    setContent(merged);
    if (recalled.mentions && recalled.mentions.length > 0) {
      setMentions((prev) => {
        const byPath = new Map(prev.map((m) => [m.path, m]));
        for (const m of recalled.mentions ?? []) byPath.set(m.path, m);
        return Array.from(byPath.values());
      });
    }
    // Re-insert any skill chips that were attached to the recalled message.
    // The editor's insertSkill handle de-dupes so we don't double-add when the
    // user had the same skill queued multiple times.
    if (recalled.skills && recalled.skills.length > 0) {
      for (const name of recalled.skills) {
        editorRef.current?.insertSkill(name);
      }
    }
    return true;
  }, [onRecallQueue, content]);

  /**
   * Stop the running turn and lift queued messages back into the composer.
   * Draining the queue BEFORE calling abort prevents the store's microtask
   * auto-flush from firing on the abort's result/error event — the queue
   * check inside the microtask sees an empty queue and no-ops.
   */
  const handleStopAndRecall = useCallback((): void => {
    handleRecallQueue();
    onAbort?.();
    // Leave focus on the editor so the user can edit immediately.
    // setText already calls editor.focus(); fall back to explicit focus
    // if the queue was empty (no recall happened).
    editorRef.current?.focus();
  }, [handleRecallQueue, onAbort]);

  const insertTextIntoEditor = useCallback((text: string): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const hasContent = content.trim().length > 0;
    const insertion = hasContent ? `\n\n${trimmed}` : trimmed;
    editorRef.current?.focus();
    editorRef.current?.insertText(insertion);
    setContent((prev) => (prev.trim().length > 0 ? `${prev}\n\n${trimmed}` : trimmed));
  }, [content]);

  const handleAgentCommand = (commandText: string): void => {
    onSubmit(commandText, messageMode, selectedModel || DEFAULT_MODEL_ID);
  };

  // Cycle mode: default → plan → accept → debug → default
  const cycleMode = useCallback(() => {
    const order: Mode[] = ['default', 'plan', 'accept', 'debug'];
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
    // Escape while streaming = stop the turn and pull queued messages back
    // into the editor for editing. Safe to call with an empty queue (no-op
    // recall, still aborts).
    if (event.key === 'Escape' && isAgentRunning) {
      event.preventDefault();
      handleStopAndRecall();
    }
  };

  useImperativeHandle(forwardedRef, () => ({
    submit: () => {
      handleSubmit();
    },
    abortWithRecall: () => {
      if (!isAgentRunning) return;
      handleStopAndRecall();
    },
    focus: () => {
      editorRef.current?.focus();
    },
    insertText: (text: string) => {
      insertTextIntoEditor(text);
    },
    addSelection: (text: string) => {
      const selection = createSelectionPill(text);
      if (!selection) return;
      setSelectionPills((prev) => [...prev, selection]);
      editorRef.current?.focus();
    },
  }));

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

  const handleRemoveSelection = useCallback((id: string) => {
    setSelectionPills((prev) => prev.filter((selection) => selection.id !== id));
  }, []);

  // Only show the selector when there are linked worktrees (more than just main)
  const showWorktreeSelector = onWorktreeChange && worktrees.length > 1;
  const canSubmit = Boolean(content.trim() || attachments.length > 0 || skillNames.length > 0 || selectionPills.length > 0);

  // Drive marketplace suggestions from the composer text (debounced inside hook).
  useSkillSuggestions(content);

  return (
    <div className={`bg-transparent ${className}`}>
      <SkillSuggestionBanner />
      <div className="mx-auto max-w-[56rem] px-4 pb-3 pt-2">
        <div className="rounded-[14px] border border-border/80 bg-card/96 shadow-[0_18px_36px_-30px_rgba(0,0,0,0.42)]">
          {showOpenAIBanner && activeSessionId && (
            <OpenAICapabilityBanner sessionId={activeSessionId} />
          )}

          <AttachmentBar />

          <DropZoneOverlay>
            <div className="px-2.5 pt-1.5">
              <SelectionPillBar selections={selectionPills} onRemove={handleRemoveSelection} />
              <LexicalEditor
                ref={editorRef}
                onChange={setContent}
                onKeyDown={handleKeyDown}
                onMentionsChange={setMentions}
                onSkillsChange={setSkillNames}
                onLocalCommand={onLocalCommand}
                onAgentCommand={handleAgentCommand}
                placeholder={
                  isAgentRunning
                    ? 'Queue a follow-up while Solo is working...'
                    : 'Ask Solo to plan, code, inspect, or debug. Use @ for files and / for skills.'
                }
                mode={messageMode}
                onEmptyUpArrow={handleRecallQueue}
              />
            </div>
          </DropZoneOverlay>

          <div className="border-t border-border/70 px-3 pb-3 pt-2" style={{ fontFamily: 'var(--font-sans)' }}>
            <div className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                <ContextMenu disabled={isAgentRunning} />
                <ModeSelector value={mode} onChange={handleModeChange} />
                <ModelPicker
                  side="top"
                  disabled={isAgentRunning}
                  className="min-w-0 max-w-[10.5rem] shrink"
                />
                <ThinkingToggle
                  enabled={thinkingEnabled}
                  onChange={(enabled) => onThinkingChange?.(enabled)}
                  disabled={isAgentRunning}
                />
                <ContextTracker disabled={isAgentRunning} />

                {showWorktreeSelector && (
                  <div className="min-w-0 basis-[120px] shrink">
                    <Select
                      value={worktreeId ?? '__main__'}
                      onValueChange={(v) => onWorktreeChange(v === '__main__' ? null : v)}
                      disabled={isAgentRunning}
                    >
                      <SelectTrigger
                        className="h-[30px] min-w-0 w-full rounded-full border-0 bg-transparent px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground ring-0 dark:ring-0 focus:outline-none focus:ring-0 focus:ring-offset-0 [&>span]:min-w-0 [&>span]:truncate"
                        title="Worktree"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__main__">Main workspace</SelectItem>
                        {worktrees.filter((wt) => !wt.is_main).map((wt) => (
                          <SelectItem key={wt.id} value={wt.id}>
                            {wt.branch ?? wt.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              <div className="ml-auto flex shrink-0 items-center gap-1">
                <VoiceButton
                  disabled={isAgentRunning}
                  onTranscript={handleVoiceTranscript}
                  showSuggestion={showVoiceSuggestion}
                  onSuggestionDismiss={handleDismissVoiceSuggestion}
                />

                <button
                  type="button"
                  className={cn(
                    toolbarButtonIconOnly,
                    'disabled:cursor-not-allowed disabled:opacity-40',
                  )}
                  aria-label="Screen record"
                  title="Screen record"
                  disabled={isAgentRunning}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 256 256" className="h-4 w-4">
                    <path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm0-160a72,72,0,1,0,72,72A72.08,72.08,0,0,0,128,56Zm0,128a56,56,0,1,1,56-56A56.06,56.06,0,0,1,128,184Z" />
                  </svg>
                </button>

                <Popover open={sketchOpen} onOpenChange={setSketchOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        toolbarButtonIconOnly,
                        'disabled:cursor-not-allowed disabled:opacity-40',
                      )}
                      aria-label="Sketch"
                      title="Sketch"
                      disabled={isAgentRunning}
                    >
                      <Paintbrush size={16} />
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

                {isAgentRunning ? (
                  <button
                    onClick={handleStopAndRecall}
                    className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] bg-destructive text-white shadow-[0_0_8px_-2px] shadow-destructive/40 transition-[transform,background-color,filter] duration-200 hover:scale-105 hover:brightness-110 active:scale-95"
                    aria-label="Stop and edit queued messages"
                    title="Stop and edit queued messages (Esc)"
                  >
                    <StopIcon width={14} height={14} />
                  </button>
                ) : (
                  <SubmitButton
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    className="shrink-0"
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export const ChatInputContainer = forwardRef(ChatInputContainerInner);

ChatInputContainer.displayName = 'ChatInputContainer';
