/**
 * ElevenLabs voice state management
 *
 * Manages STT/TTS session state, transcript data, and API key status.
 * Event handlers are called by useElevenLabsStream hook.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { toast } from 'sonner';
import type { SttStatus, TtsStatus } from '@/lib/elevenlabs/types';
import type { ElevenLabsSttPartialEvent } from '@/bindings/ElevenLabsSttPartialEvent';
import type { ElevenLabsSttCommittedEvent } from '@/bindings/ElevenLabsSttCommittedEvent';
import type { ElevenLabsSttStatusEvent } from '@/bindings/ElevenLabsSttStatusEvent';
import type { ElevenLabsTtsAudioEvent } from '@/bindings/ElevenLabsTtsAudioEvent';
import type { ElevenLabsTtsStatusEvent } from '@/bindings/ElevenLabsTtsStatusEvent';

// =============================================================================
// Types
// =============================================================================

interface SttSession {
  status: SttStatus;
  partialText: string;
  committedText: string;
  error?: string;
}

interface TtsSession {
  status: TtsStatus;
  error?: string;
}

interface ElevenLabsState {
  hasApiKey: boolean;
  /** Whether to refine voice transcripts with AI before insertion */
  refineEnabled: boolean;
  sttSessions: Map<string, SttSession>;
  ttsSessions: Map<string, TtsSession>;
}

interface ElevenLabsActions {
  setHasApiKey: (has: boolean) => void;
  setRefineEnabled: (enabled: boolean) => void;

  // STT event handlers (called by useElevenLabsStream)
  handleSttPartial: (event: ElevenLabsSttPartialEvent) => void;
  handleSttCommitted: (event: ElevenLabsSttCommittedEvent) => void;
  handleSttStatus: (event: ElevenLabsSttStatusEvent) => void;

  // TTS event handlers
  handleTtsAudio: (event: ElevenLabsTtsAudioEvent) => void;
  handleTtsStatus: (event: ElevenLabsTtsStatusEvent) => void;

  // Session management
  clearSttSession: (sessionId: string) => void;
  clearTtsSession: (sessionId: string) => void;
}

// =============================================================================
// Store
// =============================================================================

export const useElevenLabsStore = create<ElevenLabsState & ElevenLabsActions>()(
  immer((set) => ({
    hasApiKey: false,
    refineEnabled: false,
    sttSessions: new Map(),
    ttsSessions: new Map(),

    setHasApiKey: (has) =>
      set((state) => {
        state.hasApiKey = has;
      }),

    setRefineEnabled: (enabled) =>
      set((state) => {
        state.refineEnabled = enabled;
      }),

    handleSttPartial: (event) => {
      console.log('[ElevenLabs] STT partial:', event.session_id, event.text);
      set((state) => {
        const session = getOrCreateSttSession(state.sttSessions, event.session_id);
        session.partialText = event.text;
      });
    },

    handleSttCommitted: (event) => {
      console.log('[ElevenLabs] STT committed:', event.session_id, event.text);
      set((state) => {
        const session = getOrCreateSttSession(state.sttSessions, event.session_id);
        session.committedText = event.text;
        session.partialText = '';
      });
    },

    handleSttStatus: (event) => {
      console.log('[ElevenLabs] STT status:', event.session_id, event.status, event.error);
      if (event.status === 'error' && event.error) {
        toast.error('Voice input error', { description: event.error });
      }
      set((state) => {
        const session = getOrCreateSttSession(state.sttSessions, event.session_id);
        session.status = mapSttStatus(event.status);
        session.error = event.error ?? undefined;
      });
    },

    handleTtsAudio: (_event) => {
      // Audio chunks are handled directly in useTextToSpeech via AudioPlayback.
      // No store update needed for audio data — only status matters.
    },

    handleTtsStatus: (event) => {
      if (event.status === 'error' && event.error) {
        toast.error('Text-to-speech error', { description: event.error });
      }
      set((state) => {
        const session = getOrCreateTtsSession(state.ttsSessions, event.session_id);
        session.status = mapTtsStatus(event.status);
        session.error = event.error ?? undefined;
      });
    },

    clearSttSession: (sessionId) =>
      set((state) => {
        state.sttSessions.delete(sessionId);
      }),

    clearTtsSession: (sessionId) =>
      set((state) => {
        state.ttsSessions.delete(sessionId);
      }),
  })),
);

// =============================================================================
// Helpers
// =============================================================================

function getOrCreateSttSession(
  sessions: Map<string, SttSession>,
  sessionId: string,
): SttSession {
  let session = sessions.get(sessionId);
  if (!session) {
    session = { status: 'idle', partialText: '', committedText: '' };
    sessions.set(sessionId, session);
  }
  return session;
}

function getOrCreateTtsSession(
  sessions: Map<string, TtsSession>,
  sessionId: string,
): TtsSession {
  let session = sessions.get(sessionId);
  if (!session) {
    session = { status: 'idle' };
    sessions.set(sessionId, session);
  }
  return session;
}

function mapSttStatus(status: string): SttStatus {
  switch (status) {
    case 'connecting': return 'connecting';
    case 'connected': return 'connected';
    case 'ended': return 'ended';
    case 'error': return 'error';
    default: return 'idle';
  }
}

function mapTtsStatus(status: string): TtsStatus {
  switch (status) {
    case 'speaking': return 'speaking';
    case 'done': return 'done';
    case 'error': return 'error';
    default: return 'idle';
  }
}

// =============================================================================
// Selectors
// =============================================================================

const EMPTY_STT: SttSession = { status: 'idle', partialText: '', committedText: '' };
const EMPTY_TTS: TtsSession = { status: 'idle' };

export const useSttSession = (sessionId: string | null) =>
  useElevenLabsStore((s) =>
    sessionId ? s.sttSessions.get(sessionId) ?? EMPTY_STT : EMPTY_STT,
  );

export const useTtsSession = (sessionId: string | null) =>
  useElevenLabsStore((s) =>
    sessionId ? s.ttsSessions.get(sessionId) ?? EMPTY_TTS : EMPTY_TTS,
  );

export const useRefineEnabled = () =>
  useElevenLabsStore((s) => s.refineEnabled);
