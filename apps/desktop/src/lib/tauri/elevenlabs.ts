/**
 * Tauri IPC wrappers for ElevenLabs voice commands
 *
 * Type-safe invoke() calls matching the Rust elevenlabs_commands.rs
 * and event listeners for the elevenlabs:* channels.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { ElevenLabsSttPartialEvent } from '@/bindings/ElevenLabsSttPartialEvent';
import type { ElevenLabsSttCommittedEvent } from '@/bindings/ElevenLabsSttCommittedEvent';
import type { ElevenLabsSttStatusEvent } from '@/bindings/ElevenLabsSttStatusEvent';
import type { ElevenLabsTtsAudioEvent } from '@/bindings/ElevenLabsTtsAudioEvent';
import type { ElevenLabsTtsStatusEvent } from '@/bindings/ElevenLabsTtsStatusEvent';

// =============================================================================
// Commands (invoke wrappers)
// =============================================================================

export const setApiKey = (apiKey: string) =>
  invoke<void>('elevenlabs_set_api_key', { apiKey });

export const hasApiKey = () =>
  invoke<boolean>('elevenlabs_has_api_key');

export const clearApiKey = () =>
  invoke<void>('elevenlabs_clear_api_key');

export const sttStart = (sessionId: string, language?: string, sampleRate?: number) =>
  invoke<void>('elevenlabs_stt_start', { sessionId, language, sampleRate });

export const sttSendAudio = (sessionId: string, audioBase64: string) =>
  invoke<void>('elevenlabs_stt_send_audio', { sessionId, audioBase64 });

export const sttCommit = (sessionId: string) =>
  invoke<void>('elevenlabs_stt_commit', { sessionId });

export const sttStop = (sessionId: string) =>
  invoke<void>('elevenlabs_stt_stop', { sessionId });

export const ttsSpeakText = (
  sessionId: string,
  text: string,
  voiceId?: string,
  modelId?: string,
  speed?: number,
) =>
  invoke<void>('elevenlabs_tts_speak', { sessionId, text, voiceId, modelId, speed });

export const ttsStop = (sessionId: string) =>
  invoke<void>('elevenlabs_tts_stop', { sessionId });

// =============================================================================
// Event listeners
// =============================================================================

export interface ElevenLabsEventHandlers {
  onSttPartial?: (event: ElevenLabsSttPartialEvent) => void;
  onSttCommitted?: (event: ElevenLabsSttCommittedEvent) => void;
  onSttStatus?: (event: ElevenLabsSttStatusEvent) => void;
  onTtsAudio?: (event: ElevenLabsTtsAudioEvent) => void;
  onTtsStatus?: (event: ElevenLabsTtsStatusEvent) => void;
}

/**
 * Listen to all ElevenLabs events from the Rust backend.
 * Returns a cleanup function that removes all listeners.
 */
export async function listenToElevenLabsEvents(
  handlers: ElevenLabsEventHandlers,
): Promise<UnlistenFn> {
  const unlistens: UnlistenFn[] = [];

  if (handlers.onSttPartial) {
    const h = handlers.onSttPartial;
    unlistens.push(
      await listen<ElevenLabsSttPartialEvent>('elevenlabs:stt_partial', (event) => {
        h(event.payload);
      }),
    );
  }

  if (handlers.onSttCommitted) {
    const h = handlers.onSttCommitted;
    unlistens.push(
      await listen<ElevenLabsSttCommittedEvent>('elevenlabs:stt_committed', (event) => {
        h(event.payload);
      }),
    );
  }

  if (handlers.onSttStatus) {
    const h = handlers.onSttStatus;
    unlistens.push(
      await listen<ElevenLabsSttStatusEvent>('elevenlabs:stt_status', (event) => {
        h(event.payload);
      }),
    );
  }

  if (handlers.onTtsAudio) {
    const h = handlers.onTtsAudio;
    unlistens.push(
      await listen<ElevenLabsTtsAudioEvent>('elevenlabs:tts_audio', (event) => {
        h(event.payload);
      }),
    );
  }

  if (handlers.onTtsStatus) {
    const h = handlers.onTtsStatus;
    unlistens.push(
      await listen<ElevenLabsTtsStatusEvent>('elevenlabs:tts_status', (event) => {
        h(event.payload);
      }),
    );
  }

  return () => {
    for (const u of unlistens) u();
  };
}
