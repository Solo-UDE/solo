/**
 * Voice input button for ElevenLabs STT integration.
 *
 * Press to start recording, press again to stop and commit.
 * Shows partial transcript as a tooltip while recording.
 */

import React, { useCallback } from 'react';
import { Waveform, Stop } from '@phosphor-icons/react';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import { RecordingIndicator } from './recording-indicator';
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
    startRecording,
    stopRecording,
  } = useVoiceInput({ onTranscript });

  const handleClick = useCallback(async () => {
    if (isRecording) {
      await stopRecording();
    } else {
      await startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  const tooltipText = error
    ? `Voice error: ${error}`
    : isRecording
      ? partialText || 'Listening...'
      : 'Voice input';

  return (
    <div className="relative">
      <RecordingIndicator active={isRecording} />
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className={cn(
          'relative inline-flex items-center justify-center h-[30px] w-[30px] rounded-[8px] transition-[transform,background-color,color] duration-200 disabled:opacity-40 disabled:cursor-not-allowed',
          isRecording
            ? 'bg-destructive/15 text-destructive hover:bg-destructive/25 active:scale-95'
            : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground active:scale-95',
        )}
        aria-label={isRecording ? 'Stop recording' : 'Voice input'}
        title={tooltipText}
      >
        {isRecording ? (
          <Stop weight="fill" className="h-3.5 w-3.5" />
        ) : (
          <Waveform className="h-4 w-4" />
        )}
      </button>
    </div>
  );
};
