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
  private lastSource: AudioBufferSourceNode | null = null;
  private _onEnded: (() => void) | null = null;

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  set onEnded(cb: (() => void) | null) {
    this._onEnded = cb;
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

    // Track the last source so we can detect when playback truly ends
    this.lastSource = source;
  }

  /** Mark that no more chunks will arrive. Fires onEnded when the last buffer finishes. */
  markStreamDone(): void {
    if (this.lastSource && this._isPlaying) {
      this.lastSource.onended = () => {
        if (this._isPlaying) {
          this._isPlaying = false;
          this._onEnded?.();
        }
      };
    } else if (!this.lastSource) {
      // No audio was ever enqueued - fire immediately
      this._isPlaying = false;
      this._onEnded?.();
    }
  }

  /** Start accepting and playing audio chunks */
  start(): void {
    this._isPlaying = true;
    this.nextStartTime = 0;
    this.lastSource = null;
  }

  /** Stop playback and release resources */
  stop(): void {
    this._isPlaying = false;
    this.nextStartTime = 0;
    this.lastSource = null;
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
  }
}
