/**
 * Voice input button for ElevenLabs STT integration.
 *
 * Idle: 30×30 icon button with Waveform icon.
 * Recording: Expands into a pill with live waveform + red stop button.
 */

import React, { useCallback } from 'react';
import { Waveform, Stop } from '@phosphor-icons/react';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { LiveWaveform } from '@/components/ui/live-waveform';
import { cn } from '@/lib/utils';

interface VoiceButtonProps {
  disabled?: boolean;
  onTranscript?: (text: string) => void;
}

export const VoiceButton: React.FC<VoiceButtonProps> = ({
  disabled = false,
  onTranscript,
}) => {
  const {
    isRecording,
    partialText,
    error,
    analyserNode,
    startRecording,
    stopRecording,
  } = useVoiceInput({ onTranscript });

  const handleStart = useCallback(async () => {
    if (!isRecording) await startRecording();
  }, [isRecording, startRecording]);

  const handleStop = useCallback(async () => {
    if (isRecording) await stopRecording();
  }, [isRecording, stopRecording]);

  const tooltipText = error
    ? `Voice error: ${error}`
    : isRecording
      ? partialText || 'Listening...'
      : 'Voice input';

  // Idle state — simple icon button
  if (!isRecording) {
    return (
      <button
        type="button"
        onClick={handleStart}
        disabled={disabled}
        className="inline-flex items-center justify-center h-[30px] w-[30px] rounded-[8px] text-muted-foreground hover:bg-muted/60 hover:text-foreground active:scale-95 transition-[transform,background-color,color] duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="Voice input"
        title={tooltipText}
      >
        <Waveform className="h-4 w-4" />
      </button>
    );
  }

  // Recording state — expanded pill with waveform + stop button
  return (
    <div
      className="flex items-center gap-1 h-[30px] rounded-full bg-destructive/10 px-1.5 animate-fade-in-scale"
      title={tooltipText}
    >
      {/* Live waveform visualization */}
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

      {/* Stop button */}
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
        <Stop weight="fill" className="h-2.5 w-2.5" />
      </button>
    </div>
  );
};
