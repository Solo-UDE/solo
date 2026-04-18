interface WaveformProps {
  rms: number;            // 0.0–1.0
  color: string;
}

export function Waveform({ rms, color }: WaveformProps) {
  const clamped = Math.min(1, Math.max(0, rms));
  // Five bars whose heights are a gentle curve around the driving rms.
  const phases = [0.4, 0.75, 1.0, 0.75, 0.4];
  return (
    <div style={{ display: 'flex', gap: 2, alignItems: 'center', height: 20 }}>
      {phases.map((p, i) => (
        <div
          key={i}
          style={{
            width: 3,
            height: `${Math.max(2, clamped * p * 20)}px`,
            borderRadius: 2,
            background: color,
            transition: 'height 50ms linear',
          }}
        />
      ))}
    </div>
  );
}
