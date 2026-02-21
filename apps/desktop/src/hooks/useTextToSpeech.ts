/**
 * Text-to-Speech orchestration hook
 *
 * Manages TTS lifecycle: text -> backend -> ElevenLabs -> audio playback.
 * Receives audio chunks via the ElevenLabs event stream and plays them.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioPlayback } from '@/lib/elevenlabs/audio-playback';
import { ttsSpeakText, ttsStop } from '@/lib/tauri/elevenlabs';
import { useTtsSession } from '@/stores/elevenlabsStore';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { ElevenLabsTtsAudioEvent } from '@/bindings/ElevenLabsTtsAudioEvent';

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
  const playbackRef = useRef<AudioPlayback | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  const ttsSession = useTtsSession(sessionId);

  // Listen for audio chunks directly (not through store — audio needs immediate playback)
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    listen<ElevenLabsTtsAudioEvent>('elevenlabs:tts_audio', (event) => {
      const { session_id, chunk, sample_rate } = event.payload;
      if (session_id === sessionIdRef.current && playbackRef.current) {
        playbackRef.current.enqueue(chunk, sample_rate);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  const speak = useCallback(
    async (text: string) => {
      // Stop any existing playback
      if (playbackRef.current) {
        playbackRef.current.stop();
      }
      if (sessionIdRef.current) {
        ttsStop(sessionIdRef.current).catch(() => {});
      }

      const sid = `tts-${++ttsCounter}-${Date.now()}`;
      setSessionId(sid);
      sessionIdRef.current = sid;

      const playback = new AudioPlayback();
      playback.start();
      playbackRef.current = playback;

      await ttsSpeakText(sid, text, voiceId, modelId);
    },
    [voiceId, modelId],
  );

  const stop = useCallback(async () => {
    if (playbackRef.current) {
      playbackRef.current.stop();
      playbackRef.current = null;
    }
    if (sessionIdRef.current) {
      await ttsStop(sessionIdRef.current);
      sessionIdRef.current = null;
      setSessionId(null);
    }
  }, []);

  return {
    isSpeaking: ttsSession.status === 'speaking',
    status: ttsSession.status,
    error: ttsSession.error,
    speak,
    stop,
  };
}
