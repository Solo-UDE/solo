/**
 * Text-to-Speech orchestration hook
 *
 * Manages TTS lifecycle: text -> backend -> ElevenLabs -> audio playback.
 * Receives audio chunks via a module-level singleton listener so that
 * multiple hook instances (one per MessageActions) never create duplicate
 * listeners -- eliminating the double-pronunciation glitch.
 */

import { useCallback, useRef, useState } from 'react';
import { AudioPlayback } from '@/lib/elevenlabs/audio-playback';
import { ttsSpeakText, ttsStop } from '@/lib/tauri/elevenlabs';
import { useTtsSession } from '@/stores/elevenlabsStore';
import { listen } from '@tauri-apps/api/event';
import type { ElevenLabsTtsAudioEvent } from '@/bindings/ElevenLabsTtsAudioEvent';
import type { ElevenLabsTtsStatusEvent } from '@/bindings/ElevenLabsTtsStatusEvent';

// ---------------------------------------------------------------------------
// Module-level singleton listener
//
// Exactly ONE Tauri listener is registered for 'elevenlabs:tts_audio',
// regardless of how many components mount useTextToSpeech. Audio chunks
// are dispatched to the active session via `activeSession`.
// ---------------------------------------------------------------------------

interface ActiveSession {
  sessionId: string;
  playback: AudioPlayback;
  setIsPlaying: (playing: boolean) => void;
}

let activeSession: ActiveSession | null = null;
let listenerInitialized = false;

function ensureTtsListener(): void {
  if (listenerInitialized) return;
  listenerInitialized = true;

  listen<ElevenLabsTtsAudioEvent>('elevenlabs:tts_audio', (event) => {
    const { session_id, chunk, sample_rate } = event.payload;
    if (activeSession && session_id === activeSession.sessionId) {
      activeSession.playback.enqueue(chunk, sample_rate);
    }
  });

  // Listen for backend stream completion to trigger playback-end tracking
  listen<ElevenLabsTtsStatusEvent>('elevenlabs:tts_status', (event) => {
    const { session_id, status } = event.payload;
    if (status === 'done' && activeSession && session_id === activeSession.sessionId) {
      activeSession.playback.markStreamDone();
    }
  });
  // Singleton -- never unregistered. Lives for the app lifetime.
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseTextToSpeechOptions {
  voiceId?: string;
  modelId?: string;
}

interface UseTextToSpeechReturn {
  isSpeaking: boolean;
  status: string;
  error?: string;
  speak: (text: string) => Promise<void>;
  stop: () => Promise<void>;
}

let ttsCounter = 0;

export function useTextToSpeech(
  options: UseTextToSpeechOptions = {},
): UseTextToSpeechReturn {
  const { voiceId, modelId } = options;

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const playbackRef = useRef<AudioPlayback | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const ttsSession = useTtsSession(sessionId);

  // Ensure the singleton listener exists (idempotent, no useEffect needed)
  ensureTtsListener();

  const speak = useCallback(
    async (text: string) => {
      // Stop any existing playback (from this or any other hook instance)
      if (activeSession) {
        activeSession.playback.stop();
        activeSession.setIsPlaying(false);
        ttsStop(activeSession.sessionId).catch(() => {});
      }

      const sid = `tts-${++ttsCounter}-${Date.now()}`;
      setSessionId(sid);
      sessionIdRef.current = sid;

      const playback = new AudioPlayback();
      playback.onEnded = () => {
        // Only clear if this is still the active session
        if (activeSession?.sessionId === sid) {
          setIsPlaying(false);
        }
      };
      playback.start();
      playbackRef.current = playback;
      setIsPlaying(true);

      // Register as the active session for the singleton listener
      activeSession = { sessionId: sid, playback, setIsPlaying };

      await ttsSpeakText(sid, text, voiceId, modelId);
    },
    [voiceId, modelId],
  );

  const stop = useCallback(async () => {
    if (playbackRef.current) {
      playbackRef.current.stop();
      playbackRef.current = null;
    }
    setIsPlaying(false);
    if (sessionIdRef.current) {
      await ttsStop(sessionIdRef.current);
      // Clear the singleton active session if it's ours
      if (activeSession?.sessionId === sessionIdRef.current) {
        activeSession = null;
      }
      sessionIdRef.current = null;
      setSessionId(null);
    }
  }, []);

  return {
    isSpeaking: isPlaying,
    status: ttsSession.status,
    error: ttsSession.error,
    speak,
    stop,
  };
}
