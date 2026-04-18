import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useVoiceStore } from '@/stores/voiceStore';
import {
  voiceApi,
  onVoiceState,
  onVoiceTranscript,
  onVoiceError,
  onVoiceModelProgress,
  onVoiceHotkey,
  onVoiceDispatched,
  type PipelineTarget,
} from '@/lib/tauri/voice';
import type { UnlistenFn } from '@tauri-apps/api/event';

export interface UseVoiceInputOptions {
  /** Called when a transcript is finalized. */
  onTranscript: (formatted: string) => void;
}

export function useVoiceInput({ onTranscript }: UseVoiceInputOptions) {
  const pipelineState   = useVoiceStore((s) => s.pipelineState);
  const enabled         = useVoiceStore((s) => s.enabled);
  const setPipeline     = useVoiceStore((s) => s.setPipelineState);
  const setTranscript   = useVoiceStore((s) => s.setLastTranscript);
  const setError        = useVoiceStore((s) => s.setError);
  const setModelProgress= useVoiceStore((s) => s.setModelDownload);

  const unlistenRefs = useRef<UnlistenFn[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const u1 = await onVoiceState(({ state }) => setPipeline(state));
      const u2 = await onVoiceTranscript((r) => {
        setTranscript(r);
        onTranscript(r.formatted);
      });
      const u3 = await onVoiceError(setError);
      const u4 = await onVoiceModelProgress((p) =>
        setModelProgress({ bytes: Number(p.bytes), total: Number(p.total) }),
      );
      if (cancelled) {
        u1(); u2(); u3(); u4();
      } else {
        unlistenRefs.current = [u1, u2, u3, u4];
      }
    })();
    return () => {
      cancelled = true;
      unlistenRefs.current.forEach((u) => u());
      unlistenRefs.current = [];
    };
  }, [setPipeline, setTranscript, setError, setModelProgress, onTranscript]);

  useEffect(() => {
    let un: UnlistenFn | undefined;
    let currentMode: 'Dictation' | 'Dispatch' | null = null;
    (async () => {
      un = await onVoiceHotkey(async (kind) => {
        if (kind === 'dictation_down') {
          currentMode = 'Dictation';
          try {
            await voiceApi.begin('Dictation');
          } catch (e) {
            setError(String(e));
          }
        } else if (kind === 'dispatch_down') {
          currentMode = 'Dispatch';
          try {
            await voiceApi.begin('Dispatch');
          } catch (e) {
            setError(String(e));
          }
        } else if (kind === 'dictation_up' || kind === 'dispatch_up') {
          try {
            await voiceApi.end(currentMode ?? 'Dictation', 'FocusedApp');
          } catch (e) {
            setError(String(e));
          }
          currentMode = null;
        } else if (kind === 'cancel') {
          try {
            await voiceApi.cancel();
          } catch (e) {
            setError(String(e));
          }
        }
      });
    })();
    return () => un?.();
  }, [setError]);

  useEffect(() => {
    let un: UnlistenFn | undefined;
    (async () => {
      un = await onVoiceDispatched((ev) => {
        toast.success(`Agent dispatched: ${ev.title}`);
        useVoiceStore.getState().setPendingDispatch(ev);
      });
    })();
    return () => un?.();
  }, []);

  const start = useCallback(async () => {
    if (!enabled) {
      setError('Voice is disabled. Enable it in Settings → Voice.');
      return;
    }
    try {
      await voiceApi.begin('Dictation');
    } catch (e) {
      setError(String(e));
    }
  }, [enabled, setError]);

  const stop = useCallback(async (target: PipelineTarget = 'ChatInput') => {
    try {
      await voiceApi.end('Dictation', target);
    } catch (e) {
      setError(String(e));
    }
  }, [setError]);

  const cancel = useCallback(async () => {
    try {
      await voiceApi.cancel();
    } catch (e) {
      setError(String(e));
    }
  }, [setError]);

  const isRecording =
    typeof pipelineState === 'object' &&
    'kind' in pipelineState &&
    pipelineState.kind === 'Recording';

  return { start, stop, cancel, isRecording, state: pipelineState };
}
