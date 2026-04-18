import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { VoiceMode } from '@/bindings/VoiceMode';
import type { VoicePipelineState } from '@/bindings/VoicePipelineState';
import type { VoiceTranscriptResult } from '@/bindings/VoiceTranscriptResult';
import type { VoiceModelProgress } from '@/bindings/VoiceModelProgress';
import type { ShortcutsConfig } from '@/bindings/ShortcutsConfig';
import type { VoicePermissions } from '@/bindings/VoicePermissions';

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
  getShortcuts:      () => invoke<ShortcutsConfig>('voice_get_shortcuts'),
  setShortcuts:      (shortcuts: ShortcutsConfig) => invoke<void>('voice_set_shortcuts', { shortcuts }),
  checkPermissions:  () => invoke<VoicePermissions>('voice_check_permissions'),
  requestPermission: (which: 'microphone' | 'input-monitoring' | 'accessibility') =>
                       invoke<VoicePermissions>('voice_request_permission', { which }),
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

export function onVoiceLevel(cb: (rms: number) => void): Promise<UnlistenFn> {
  return listen<{ rms: number }>('voice:level', (e) => cb(e.payload.rms));
}

export type HotkeyKind = 'dictation_down' | 'dictation_up' | 'dispatch_down' | 'dispatch_up' | 'cancel';

export function onVoiceHotkey(cb: (kind: HotkeyKind) => void): Promise<UnlistenFn> {
  return listen<HotkeyKind>('voice:hotkey', (e) => cb(e.payload));
}

export interface DispatchEvent {
  session_id: string;
  title: string;
}

export function onVoiceDispatched(cb: (p: DispatchEvent) => void): Promise<UnlistenFn> {
  return listen<DispatchEvent>('voice:dispatched', (e) => cb(e.payload));
}
