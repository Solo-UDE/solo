/**
 * Audio playback queue for ElevenLabs TTS streaming
 *
 * Receives base64-encoded PCM audio chunks and plays them sequentially
 * through the Web Audio API, maintaining a buffer for smooth playback.
 */

import { base64ToInt16, int16ToFloat32 } from './pcm-utils';

/**
 * Queued audio playback engine for streaming TTS.
 *
 * Chunks are queued and played back-to-back using AudioBufferSourceNode
 * scheduling for gapless playback.
 */
export class AudioPlayback {
  private audioContext: AudioContext | null = null;
  private nextStartTime = 0;
  private _isPlaying = false;

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  /** Enqueue a base64-encoded PCM chunk for playback */
  enqueue(base64Chunk: string, sampleRate: number): void {
    if (!this._isPlaying) return;

    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate });
    }

    const int16 = base64ToInt16(base64Chunk);
    const float32 = int16ToFloat32(int16);

    const buffer = this.audioContext.createBuffer(1, float32.length, sampleRate);
    buffer.getChannelData(0).set(float32);

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);

    // Schedule this chunk right after the previous one
    const now = this.audioContext.currentTime;
    const startTime = Math.max(now, this.nextStartTime);
    source.start(startTime);
    this.nextStartTime = startTime + buffer.duration;
  }

  /** Start accepting and playing audio chunks */
  start(): void {
    this._isPlaying = true;
    this.nextStartTime = 0;
  }

  /** Stop playback and release resources */
  stop(): void {
    this._isPlaying = false;
    this.nextStartTime = 0;
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }
}
