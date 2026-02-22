/**
 * Real-time audio frequency visualizer using Web Audio AnalyserNode.
 *
 * Renders symmetric centered bars on a <canvas> element, driven by
 * requestAnimationFrame. Designed to visualize voice input activity.
 */

import { useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface LiveWaveformProps {
  /** AnalyserNode providing frequency data (from AudioCapture) */
  analyserNode: AnalyserNode | null;
  /** Whether the visualization is active (controls animation loop) */
  active: boolean;
  /** Width of each frequency bar in px (default: 3) */
  barWidth?: number;
  /** Gap between bars in px (default: 1) */
  barGap?: number;
  /** Border radius of each bar in px (default: 1.5) */
  barRadius?: number;
  /** Bar color — CSS color string (default: currentColor from canvas context) */
  barColor?: string;
  /** Apply gradient fade at left/right edges (default: true) */
  fadeEdges?: boolean;
  /** Canvas height in px (default: 24) */
  height?: number;
  /** Amplitude sensitivity multiplier (default: 1.5) */
  sensitivity?: number;
  /** Additional CSS classes on the canvas element */
  className?: string;
}

export const LiveWaveform: React.FC<LiveWaveformProps> = ({
  analyserNode,
  active,
  barWidth = 3,
  barGap = 1,
  barRadius = 1.5,
  barColor,
  fadeEdges = true,
  height = 24,
  sensitivity = 1.5,
  className,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const containerWidthRef = useRef(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyserNode || !active) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    // Read frequency data
    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserNode.getByteFrequencyData(dataArray);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    // Calculate bar layout
    const step = barWidth + barGap;
    const barCount = Math.floor(w / step);
    const totalBarsWidth = barCount * step - barGap;
    const offsetX = (w - totalBarsWidth) / 2;

    // Resolve bar color
    const color = barColor || getComputedStyle(canvas).color || '#fff';
    ctx.fillStyle = color;

    // Draw centered bars
    for (let i = 0; i < barCount; i++) {
      // Map bar index to frequency bin (use lower half of spectrum for voice)
      const freqIndex = Math.floor((i / barCount) * Math.min(bufferLength, 64));
      const value = dataArray[freqIndex] / 255;
      const amplitude = Math.max(value * sensitivity, 0.08); // minimum visible height
      const barHeight = amplitude * h;

      const x = offsetX + i * step;
      const y = (h - barHeight) / 2;

      // Edge fade: reduce opacity near edges
      let opacity = 1;
      if (fadeEdges) {
        const normalizedPos = i / barCount;
        const edgeDist = Math.min(normalizedPos, 1 - normalizedPos);
        opacity = Math.min(edgeDist * 5, 1); // fade over first/last 20%
      }

      ctx.globalAlpha = opacity;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, barRadius);
      ctx.fill();
    }

    ctx.restore();

    animFrameRef.current = requestAnimationFrame(draw);
  }, [analyserNode, active, barWidth, barGap, barRadius, barColor, fadeEdges, height, sensitivity]);

  // Handle canvas sizing via ResizeObserver
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      containerWidthRef.current = rect.width;
      canvas.width = rect.width * dpr;
      canvas.height = height * dpr;
    };

    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [height]);

  // Animation loop lifecycle
  useEffect(() => {
    // Respect prefers-reduced-motion
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (motionQuery.matches) return;

    if (active && analyserNode) {
      animFrameRef.current = requestAnimationFrame(draw);
    }

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = 0;
      }
    };
  }, [active, analyserNode, draw]);

  return (
    <canvas
      ref={canvasRef}
      className={cn('block', className)}
      style={{ width: '100%', height }}
      aria-hidden="true"
    />
  );
};
