import { describe, expect, it } from 'bun:test';
import { useVoiceStore } from '@/stores/voiceStore';

describe('voiceStore', () => {
  it('transitions pipeline state', () => {
    const { setPipelineState } = useVoiceStore.getState();
    setPipelineState({ kind: 'Recording' });
    expect(useVoiceStore.getState().pipelineState).toEqual({ kind: 'Recording' });
  });

  it('clears error when set to null', () => {
    const { setError } = useVoiceStore.getState();
    setError('x');
    expect(useVoiceStore.getState().error).toBe('x');
    setError(null);
    expect(useVoiceStore.getState().error).toBeNull();
  });
});
