import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { VoiceMode } from '@/bindings/VoiceMode';
import type { VoicePipelineState } from '@/bindings/VoicePipelineState';
import type { VoiceTranscriptResult } from '@/bindings/VoiceTranscriptResult';
import type { VoiceModelProgress } from '@/bindings/VoiceModelProgress';

export type PipelineTarget = 'ChatInput' | 'FocusedApp' | 'NewAgentSession';

export const voiceApi = {
  enable:            () => invoke<void>('voice_enable'),
  downloadParakeet:  () => invoke<void>('voice_download_parakeet'),
  parakeetInstalled: () => invoke<boolean>('voice_parakeet_installed'),
  begin:             (mode: VoiceMode) => invoke<void>('voice_begin', { mode }),
  end:               (mode: VoiceMode, target: PipelineTarget) =>
                       invoke<void>('voice_end', { mode, target }),
  cancel:            () => invoke<void>('voice_cancel'),
  historyList:       (limit = 50) =>
                       invoke<VoiceTranscriptResult[]>('voice_history_list', { limit }),
  historyDelete:     (id: string) => invoke<void>('voice_history_delete', { id }),
};

export function onVoiceState(
  cb: (p: { mode: VoiceMode; state: VoicePipelineState }) => void,
): Promise<UnlistenFn> {
  return listen<{ mode: VoiceMode; state: VoicePipelineState }>('voice:state', (e) =>
    cb(e.payload),
  );
}

export function onVoiceTranscript(
  cb: (r: VoiceTranscriptResult) => void,
): Promise<UnlistenFn> {
  return listen<{ result: VoiceTranscriptResult }>('voice:transcript', (e) =>
    cb(e.payload.result),
  );
}

export function onVoiceError(cb: (msg: string) => void): Promise<UnlistenFn> {
  return listen<{ message: string }>('voice:error', (e) => cb(e.payload.message));
}

export function onVoiceModelProgress(
  cb: (p: VoiceModelProgress) => void,
): Promise<UnlistenFn> {
  return listen<{ progress: VoiceModelProgress }>('voice:model_progress', (e) =>
    cb(e.payload.progress),
  );
}
