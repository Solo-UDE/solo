/**
 * Voice input orchestration hook
 *
 * Manages the full STT lifecycle: mic capture -> IPC -> backend -> ElevenLabs
 * Returns recording state, partial text, and control functions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { checkMicrophonePermission, requestMicrophonePermission } from 'tauri-plugin-macos-permissions-api';
import { AudioCapture } from '@/lib/elevenlabs/audio-capture';
import { sttStart, sttSendAudio, sttCommit, sttStop, hasApiKey } from '@/lib/tauri/elevenlabs';
import { refineTranscript } from '@/lib/tauri/agent';
import { useSttSession, useRefineEnabled } from '@/stores/elevenlabsStore';

interface UseVoiceInputOptions {
  /** Callback when a final transcript is committed */
  onTranscript?: (text: string) => void;
  /** Language code for STT (default: "en") */
  language?: string;
  /** Recent chat context to improve transcription accuracy (sent to ElevenLabs as previous_text) */
  previousText?: string;
  /** Chat context for LLM-based refinement */
  chatContext?: string;
}

interface UseVoiceInputReturn {
  /** Whether currently recording */
  isRecording: boolean;
  /** Whether the transcript is being refined by LLM */
  isRefining: boolean;
  /** Current partial (interim) transcript text */
  partialText: string;
  /** Current committed transcript text */
  committedText: string;
  /** STT connection status */
  status: string;
  /** Error message if any */
  error?: string;
  /** AnalyserNode for real-time frequency visualization (null when not recording) */
  analyserNode: AnalyserNode | null;
  /** Start voice recording */
  startRecording: () => Promise<void>;
  /** Stop recording and commit transcript */
  stopRecording: () => Promise<void>;
}

let sessionCounter = 0;

export function useVoiceInput(
  options: UseVoiceInputOptions = {},
): UseVoiceInputReturn {
  const { onTranscript, language, previousText, chatContext } = options;

  const [isRecording, setIsRecording] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string>();
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);

  const captureRef = useRef<AudioCapture | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const refineEnabled = useRefineEnabled();
  const refineEnabledRef = useRef(refineEnabled);
  refineEnabledRef.current = refineEnabled;
  const chatContextRef = useRef(chatContext);
  chatContextRef.current = chatContext;

  const sttSession = useSttSession(sessionId);

  // When a committed transcript arrives, optionally refine it via LLM then invoke callback
  const lastCommittedRef = useRef('');
  useEffect(() => {
    if (!sttSession.committedText || sttSession.committedText === lastCommittedRef.current) return;
    lastCommittedRef.current = sttSession.committedText;
    const rawText = sttSession.committedText;
    let cancelled = false;

    if (refineEnabledRef.current) {
      setIsRefining(true);
      console.log('[VoiceInput] Refining transcript via LLM...');
      refineTranscript(rawText, chatContextRef.current)
        .then((refined) => {
          if (!cancelled) onTranscriptRef.current?.(refined);
        })
        .catch((err) => {
          console.warn('[VoiceInput] Refinement failed, using raw:', err);
          if (!cancelled) onTranscriptRef.current?.(rawText);
        })
        .finally(() => { if (!cancelled) setIsRefining(false); });
    } else {
      onTranscriptRef.current?.(rawText);
    }

    return () => { cancelled = true; };
  }, [sttSession.committedText]);

  // Auto-stop recording when backend session errors or ends
  const lastStatusRef = useRef(sttSession.status);
  if (sttSession.status !== lastStatusRef.current) {
    lastStatusRef.current = sttSession.status;
    if ((sttSession.status === 'error' || sttSession.status === 'ended') && captureRef.current) {
      console.log('[VoiceInput] Session died, stopping mic capture');
      captureRef.current.stop();
      captureRef.current = null;
      setAnalyserNode(null);
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

    // Best-effort macOS mic permission request (non-blocking).
    // If the Tauri plugin can't trigger the native dialog (e.g. in dev mode),
    // fall through and let AudioCapture's getUserMedia() handle it instead.
    try {
      const micAllowed = await checkMicrophonePermission();
      console.log('[VoiceInput] checkMicrophonePermission:', micAllowed);
      if (!micAllowed) {
        const granted = await requestMicrophonePermission();
        console.log('[VoiceInput] requestMicrophonePermission:', granted);
        // Don't return early — let AudioCapture try getUserMedia() as a fallback.
        // It has its own NotAllowedError handling that shows the toast.
      }
    } catch (permErr) {
      console.warn('[VoiceInput] macOS permission check unavailable:', permErr);
    }

    try {
      // Step 1: Start mic capture FIRST to discover the actual sample rate
      // (macOS may give us 48000 instead of the requested 16000)
      // Buffer chunks until the backend WebSocket is ready to avoid race condition.
      let sttReady = false;
      const pendingChunks: string[] = [];

      const capture = new AudioCapture({
        onChunk: (base64Audio) => {
          if (sessionIdRef.current) {
            if (sttReady) {
              sttSendAudio(sessionIdRef.current, base64Audio).catch(() => {});
            } else {
              pendingChunks.push(base64Audio);
            }
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
      setAnalyserNode(capture.analyserNode);

      const actualRate = capture.actualSampleRate;
      console.log(`[VoiceInput] Mic started, actual sample rate: ${actualRate}`);

      // Step 2: Open backend WebSocket with the ACTUAL sample rate
      // Pass previousText for ElevenLabs context-aware transcription
      await sttStart(sid, language, actualRate, previousText);
      sttReady = true;

      // Flush any chunks that arrived while the WebSocket was connecting
      for (const chunk of pendingChunks) {
        sttSendAudio(sid, chunk).catch(() => {});
      }

      setIsRecording(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLocalError(msg);
      setIsRecording(false);
      setAnalyserNode(null);

      // Clean up mic, session ID, and backend session
      captureRef.current?.stop();
      captureRef.current = null;
      setSessionId(null);
      sessionIdRef.current = null;
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
  }, [isRecording, language, previousText]);

  const stopRecording = useCallback(async () => {
    if (!isRecording || !sessionIdRef.current) return;

    const sid = sessionIdRef.current;

    // Stop mic capture first
    captureRef.current?.stop();
    captureRef.current = null;
    setAnalyserNode(null);

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

  // Filter out ElevenLabs context echo from partials.
  // When previous_text is sent, ElevenLabs echoes it back as the first partial
  // before real speech starts. The committed transcript is clean but the UI
  // flashes the raw context text without this filter.
  const filteredPartialText = useMemo(() => {
    if (!previousText || !sttSession.partialText) return sttSession.partialText;
    if (sttSession.partialText.startsWith(previousText.substring(0, 30))) {
      return '';
    }
    return sttSession.partialText;
  }, [sttSession.partialText, previousText]);

  return {
    isRecording,
    isRefining,
    partialText: filteredPartialText,
    committedText: sttSession.committedText,
    status: sttSession.status,
    error: localError ?? sttSession.error,
    analyserNode,
    startRecording,
    stopRecording,
  };
}
