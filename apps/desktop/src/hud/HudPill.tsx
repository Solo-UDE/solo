import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { VoiceMode } from '@/bindings/VoiceMode';
import type { VoicePipelineState } from '@/bindings/VoicePipelineState';
import { Waveform } from './waveform';

export function HudPill() {
  const [mode, setMode] = useState<VoiceMode>('Dictation');
  const [state, setState] = useState<VoicePipelineState>({ kind: 'Idle' });
  const [rms, setRms] = useState(0);

  useEffect(() => {
    const u1 = listen<{ mode: VoiceMode; state: VoicePipelineState }>('voice:state', (e) => {
      setMode(e.payload.mode);
      setState(e.payload.state);
    });
    const u2 = listen<{ rms: number }>('voice:level', (e) => setRms(e.payload.rms));
    return () => {
      u1.then((u) => u());
      u2.then((u) => u());
    };
  }, []);

  const color = mode === 'Dispatch' ? '#00D37F' : 'white';
  const kind = typeof state === 'object' && 'kind' in state ? state.kind : 'Idle';

  return (
    <div
      style={{
        padding: '6px 10px',
        borderRadius: 999,
        background: 'rgba(0,0,0,0.7)',
        color: 'white',
        font: '13px -apple-system, system-ui',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      {kind === 'Recording' && (
        <>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: color }} />
          <Waveform rms={rms} color={color} />
        </>
      )}
      {(kind === 'Transcribing' || kind === 'Formatting') && (
        <>
          <span
            style={{
              width: 10,
              height: 10,
              border: `2px solid ${color}`,
              borderTopColor: 'transparent',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }}
          />
          <span>{kind}…</span>
        </>
      )}
      {kind === 'Error' && (
        <span style={{ color: '#ff6b6b' }}>Error</span>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
