import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { VoicePipelineState } from '@/bindings/VoicePipelineState';
import type { VoiceTranscriptResult } from '@/bindings/VoiceTranscriptResult';

interface VoiceStore {
  enabled: boolean;
  parakeetInstalled: boolean;
  pipelineState: VoicePipelineState;
  lastTranscript: VoiceTranscriptResult | null;
  error: string | null;
  modelDownload: { bytes: number; total: number } | null;

  setEnabled: (v: boolean) => void;
  setParakeetInstalled: (v: boolean) => void;
  setPipelineState: (s: VoicePipelineState) => void;
  setLastTranscript: (r: VoiceTranscriptResult) => void;
  setError: (msg: string | null) => void;
  setModelDownload: (p: { bytes: number; total: number } | null) => void;
}

export const useVoiceStore = create<VoiceStore>()(
  immer((set) => ({
    enabled: false,
    parakeetInstalled: false,
    pipelineState: { kind: 'Idle' } as VoicePipelineState,
    lastTranscript: null,
    error: null,
    modelDownload: null,

    setEnabled:            (v) => set((s) => { s.enabled = v; }),
    setParakeetInstalled:  (v) => set((s) => { s.parakeetInstalled = v; }),
    setPipelineState:      (p) => set((s) => { s.pipelineState = p; }),
    setLastTranscript:     (r) => set((s) => { s.lastTranscript = r; }),
    setError:              (e) => set((s) => { s.error = e; }),
    setModelDownload:      (p) => set((s) => { s.modelDownload = p; }),
  })),
);
