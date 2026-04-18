import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { VoicePipelineState } from '@/bindings/VoicePipelineState';
import type { VoiceTranscriptResult } from '@/bindings/VoiceTranscriptResult';
import type { ShortcutsConfig } from '@/bindings/ShortcutsConfig';
import type { VoicePermissions } from '@/bindings/VoicePermissions';
import type { DispatchEvent } from '@/lib/tauri/voice';

interface VoiceStore {
  enabled: boolean;
  parakeetInstalled: boolean;
  pipelineState: VoicePipelineState;
  lastTranscript: VoiceTranscriptResult | null;
  error: string | null;
  modelDownload: { bytes: number; total: number } | null;
  shortcuts: ShortcutsConfig;
  permissions: VoicePermissions;
  rmsLevel: number;
  pendingDispatch: DispatchEvent | null;

  setEnabled: (v: boolean) => void;
  setParakeetInstalled: (v: boolean) => void;
  setPipelineState: (s: VoicePipelineState) => void;
  setLastTranscript: (r: VoiceTranscriptResult) => void;
  setError: (msg: string | null) => void;
  setModelDownload: (p: { bytes: number; total: number } | null) => void;
  setShortcuts: (s: ShortcutsConfig) => void;
  setPermissions: (p: VoicePermissions) => void;
  setRmsLevel: (v: number) => void;
  setPendingDispatch: (d: DispatchEvent | null) => void;
}

export const useVoiceStore = create<VoiceStore>()(
  immer((set) => ({
    enabled: false,
    parakeetInstalled: false,
    pipelineState: { kind: 'Idle' } as VoicePipelineState,
    lastTranscript: null,
    error: null,
    modelDownload: null,
    shortcuts: {
      dictation_ptt: 'fn',
      dispatch_ptt: 'ctrl+alt+space',
      cancel: 'escape',
    },
    permissions: {
      microphone: false,
      input_monitoring: false,
      accessibility: false,
    },
    rmsLevel: 0,
    pendingDispatch: null,

    setEnabled:            (v) => set((s) => { s.enabled = v; }),
    setParakeetInstalled:  (v) => set((s) => { s.parakeetInstalled = v; }),
    setPipelineState:      (p) => set((s) => { s.pipelineState = p; }),
    setLastTranscript:     (r) => set((s) => { s.lastTranscript = r; }),
    setError:              (e) => set((s) => { s.error = e; }),
    setModelDownload:      (p) => set((s) => { s.modelDownload = p; }),
    setShortcuts:          (s) => set((state) => { state.shortcuts = s; }),
    setPermissions:        (p) => set((state) => { state.permissions = p; }),
    setRmsLevel:           (v) => set((state) => { state.rmsLevel = v; }),
    setPendingDispatch:    (d) => set((state) => { state.pendingDispatch = d; }),
  })),
);
