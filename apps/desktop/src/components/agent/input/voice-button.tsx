/**
 * Voice input button for ElevenLabs STT integration.
 *
 * Idle: 30x30 icon button with Waveform icon.
 * Recording: Expands into a pill with live waveform + red stop button.
 * When showSuggestion is true, the idle button expands into a pill
 * that reveals "Try speaking" text, then auto-dismisses.
 */

import React, { useCallback, useEffect } from 'react';
import { StopIcon } from '@radix-ui/react-icons';
import { AudioLines } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { LiveWaveform } from '@/components/ui/live-waveform';
import { cn } from '@/lib/utils';

interface VoiceButtonProps {
  disabled?: boolean;
  onTranscript?: (text: string) => void;
  showSuggestion?: boolean;
  onSuggestionDismiss?: () => void;
  /** Recent chat context for ElevenLabs previous_text transcription improvement */
  previousText?: string;
  /** Chat context for LLM-based refinement */
  chatContext?: string;
}

export const VoiceButton: React.FC<VoiceButtonProps> = ({
  disabled = false,
  onTranscript,
  showSuggestion = false,
  onSuggestionDismiss,
  previousText,
  chatContext,
}) => {
  const {
    isRecording,
    isRefining,
    partialText,
    error,
    analyserNode,
    startRecording,
    stopRecording,
  } = useVoiceInput({ onTranscript, previousText, chatContext });

  // Auto-dismiss suggestion after 5 seconds
  useEffect(() => {
    if (!showSuggestion) return;
    const timer = setTimeout(() => {
      onSuggestionDismiss?.();
    }, 5000);
    return () => clearTimeout(timer);
  }, [showSuggestion, onSuggestionDismiss]);

  const handleStart = useCallback(async () => {
    if (showSuggestion) {
      onSuggestionDismiss?.();
    }
    if (!isRecording) await startRecording();
  }, [isRecording, showSuggestion, startRecording, onSuggestionDismiss]);

  const handleStop = useCallback(async () => {
    if (isRecording) await stopRecording();
  }, [isRecording, stopRecording]);

  const tooltipText = error
    ? `Voice error: ${error}`
    : isRefining
      ? 'Refining...'
      : isRecording
        ? partialText || 'Listening...'
        : 'Voice input';

  const isSuggestionVisible = showSuggestion && !isRecording && !isRefining;

  // Refining state - brief indicator while LLM processes transcript
  if (isRefining) {
    return (
      <div
        className="flex items-center gap-1.5 h-[30px] rounded-full bg-muted/60 px-2.5 animate-fade-in-scale"
        title="Refining transcript..."
      >
        <div className="h-3 w-3 rounded-full border-2 border-foreground/30 border-t-foreground/80 animate-spin" />
        <span className="text-xs font-medium text-muted-foreground">Refining…</span>
      </div>
    );
  }

  // Recording state - expanded pill with waveform + stop button
  if (isRecording) {
    return (
      <div
        className="flex items-center gap-1 h-[30px] rounded-full bg-destructive/10 px-1.5 animate-fade-in-scale"
        title={tooltipText}
      >
        <div className="w-[72px] flex items-center">
          <LiveWaveform
            analyserNode={analyserNode}
            active={isRecording}
            height={22}
            barWidth={2.5}
            barGap={1.5}
            barRadius={1.5}
            sensitivity={1.8}
            className="text-destructive"
          />
        </div>
        <button
          type="button"
          onClick={handleStop}
          className={cn(
            'inline-flex items-center justify-center w-[22px] h-[22px] rounded-full flex-shrink-0',
            'bg-destructive text-white',
            'shadow-[0_0_8px_-2px] shadow-destructive/40',
            'hover:brightness-110 active:scale-90 transition-[transform,filter] duration-150',
          )}
          aria-label="Stop recording"
        >
          <StopIcon width={10} height={10} />
        </button>
      </div>
    );
  }

  // Idle state - icon button (expands with suggestion text when showSuggestion)
  return (
    <motion.button
      type="button"
      onClick={handleStart}
      disabled={disabled}
      layout
      animate={{
        width: isSuggestionVisible ? 'auto' : 30,
      }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={cn(
        'inline-flex items-center justify-center h-[30px] rounded-[8px] transition-[background-color,color] duration-200 disabled:opacity-40 disabled:cursor-not-allowed overflow-hidden whitespace-nowrap',
        isSuggestionVisible
          ? 'bg-muted/60 text-foreground hover:bg-muted/80'
          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground active:scale-95',
      )}
      style={{ minWidth: 30 }}
      aria-label="Voice input"
      title={isSuggestionVisible ? 'Try speaking' : tooltipText}
    >
      <div className="flex items-center gap-1.5 px-2">
        <AudioLines
          className="h-4 w-4 shrink-0"
          style={isSuggestionVisible ? { color: 'hsl(var(--solo-green))' } : undefined}
        />
        <AnimatePresence>
          {isSuggestionVisible && (
            <motion.span
              initial={{ opacity: 0, x: -4, width: 0 }}
              animate={{ opacity: 1, x: 0, width: 'auto' }}
              exit={{ opacity: 0, x: -4, width: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="text-xs font-medium text-muted-foreground overflow-hidden"
            >
              Try speaking
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </motion.button>
  );
};
