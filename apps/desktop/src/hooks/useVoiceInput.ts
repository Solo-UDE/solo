/**
 * Voice input orchestration hook
 *
 * Manages the full STT lifecycle: mic capture -> IPC -> backend -> ElevenLabs
 * Returns recording state, partial text, and control functions.
 */

import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AudioCapture } from '@/lib/elevenlabs/audio-capture';
import { sttStart, sttSendAudio, sttCommit, sttStop, hasApiKey } from '@/lib/tauri/elevenlabs';
import { useSttSession } from '@/stores/elevenlabsStore';

interface UseVoiceInputOptions {
  /** Callback when a final transcript is committed */
  onTranscript?: (text: string) => void;
  /** Language code for STT (default: "en") */
  language?: string;
}

interface UseVoiceInputReturn {
  /** Whether currently recording */
  isRecording: boolean;
  /** Current partial (interim) transcript text */
  partialText: string;
  /** Current committed transcript text */
  committedText: string;
  /** STT connection status */
  status: string;
  /** Error message if any */
  error?: string;
  /** Start voice recording */
  startRecording: () => Promise<void>;
  /** Stop recording and commit transcript */
  stopRecording: () => Promise<void>;
}

let sessionCounter = 0;

export function useVoiceInput(
  options: UseVoiceInputOptions = {},
): UseVoiceInputReturn {
  const { onTranscript, language } = options;

  const [isRecording, setIsRecording] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string>();

  const captureRef = useRef<AudioCapture | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const sttSession = useSttSession(sessionId);

  // When a committed transcript arrives, invoke the callback
  const lastCommittedRef = useRef('');
  if (sttSession.committedText && sttSession.committedText !== lastCommittedRef.current) {
    lastCommittedRef.current = sttSession.committedText;
    console.log('[VoiceInput] Committed transcript, inserting:', sttSession.committedText);
    onTranscriptRef.current?.(sttSession.committedText);
  }

  // Auto-stop recording when backend session errors or ends
  const lastStatusRef = useRef(sttSession.status);
  if (sttSession.status !== lastStatusRef.current) {
    lastStatusRef.current = sttSession.status;
    if ((sttSession.status === 'error' || sttSession.status === 'ended') && captureRef.current) {
      console.log('[VoiceInput] Session died, stopping mic capture');
      captureRef.current.stop();
      captureRef.current = null;
      setIsRecording(false);
    }
  }

  const startRecording = useCallback(async () => {
    if (isRecording) return;

    setLocalError(undefined);

    // Check API key first
    try {
      const keySet = await hasApiKey();
      if (!keySet) {
        toast.error('ElevenLabs API key not set', {
          description: 'Go to Settings > Voice to add your API key.',
        });
        return;
      }
    } catch {
      // Ignore check failure, let the sttStart call handle it
    }

    const sid = `stt-${++sessionCounter}-${Date.now()}`;
    setSessionId(sid);
    sessionIdRef.current = sid;
    lastCommittedRef.current = '';

    try {
      // Step 1: Start mic capture FIRST to discover the actual sample rate
      // (macOS may give us 48000 instead of the requested 16000)
      const capture = new AudioCapture({
        onChunk: (base64Audio) => {
          if (sessionIdRef.current) {
            sttSendAudio(sessionIdRef.current, base64Audio).catch(() => {
              // Ignore send errors after session is closed
            });
          }
        },
        onError: (err) => {
          console.error('Mic capture error:', err);
          setLocalError(err.message);
          if (err.name === 'NotAllowedError') {
            toast.error('Microphone access denied', {
              description: 'Allow microphone access in System Settings > Privacy & Security.',
            });
          } else {
            toast.error('Microphone error', {
              description: err.message,
            });
          }
        },
      });

      await capture.start();
      captureRef.current = capture;

      const actualRate = capture.actualSampleRate;
      console.log(`[VoiceInput] Mic started, actual sample rate: ${actualRate}`);

      // Step 2: Open backend WebSocket with the ACTUAL sample rate
      await sttStart(sid, language, actualRate);

      setIsRecording(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLocalError(msg);
      setIsRecording(false);

      // Clean up mic and session
      captureRef.current?.stop();
      captureRef.current = null;
      sttStop(sid).catch(() => {});

      // Show contextual error toast
      if (msg.includes('NotAllowedError') || msg.includes('Permission')) {
        toast.error('Microphone access denied', {
          description: 'Allow microphone access in System Settings > Privacy & Security.',
        });
      } else if (msg.includes('API key')) {
        toast.error('ElevenLabs API key not set', {
          description: 'Go to Settings > Voice to add your API key.',
        });
      } else if (msg.includes('Authentication') || msg.includes('401') || msg.includes('auth')) {
        toast.error('Invalid ElevenLabs API key', {
          description: 'Check your API key in Settings > Voice.',
        });
      } else if (msg.includes('quota') || msg.includes('429') || msg.includes('rate')) {
        toast.error('ElevenLabs quota exceeded', {
          description: 'Check your usage limits at elevenlabs.io.',
        });
      } else {
        toast.error('Voice input failed', {
          description: msg,
        });
      }
    }
  }, [isRecording, language]);

  const stopRecording = useCallback(async () => {
    if (!isRecording || !sessionIdRef.current) return;

    const sid = sessionIdRef.current;

    // Stop mic capture first
    captureRef.current?.stop();
    captureRef.current = null;

    // Commit the current audio buffer, then close the session
    try {
      await sttCommit(sid);
    } catch {
      // Session may already be closed
    }

    // Small delay to let the final transcript arrive before closing
    setTimeout(async () => {
      try {
        await sttStop(sid);
      } catch {
        // Ignore
      }
    }, 500);

    setIsRecording(false);
  }, [isRecording]);

  return {
    isRecording,
    partialText: sttSession.partialText,
    committedText: sttSession.committedText,
    status: sttSession.status,
    error: localError ?? sttSession.error,
    startRecording,
    stopRecording,
  };
}
