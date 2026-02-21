/**
 * Microphone audio capture for ElevenLabs STT
 *
 * Uses Web Audio API to capture microphone input, convert to 16-bit PCM,
 * and emit base64-encoded chunks suitable for IPC transport to Rust backend.
 */

import { float32ToInt16, int16ToBase64 } from './pcm-utils';

export interface AudioCaptureOptions {
  /** Sample rate in Hz (default: 16000, matches ElevenLabs STT) */
  sampleRate?: number;
  /** Callback invoked with base64-encoded PCM chunks */
  onChunk: (base64Audio: string) => void;
  /** Callback invoked on error */
  onError?: (error: Error) => void;
}

/**
 * Manages microphone capture and PCM chunk emission.
 *
 * Usage:
 *   const capture = new AudioCapture({ onChunk: (b64) => sendToBackend(b64) });
 *   await capture.start();
 *   console.log('Actual sample rate:', capture.actualSampleRate);
 *   // ... recording ...
 *   capture.stop();
 */
export class AudioCapture {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private workletNode: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private options: Required<AudioCaptureOptions>;
  private _isRecording = false;
  private _actualSampleRate = 16000;

  constructor(options: AudioCaptureOptions) {
    this.options = {
      sampleRate: options.sampleRate ?? 16000,
      onChunk: options.onChunk,
      onError: options.onError ?? (() => {}),
    };
  }

  get isRecording(): boolean {
    return this._isRecording;
  }

  /** The actual sample rate from the AudioContext (may differ from requested) */
  get actualSampleRate(): number {
    return this._actualSampleRate;
  }

  /** Request microphone permission and start capturing audio */
  async start(): Promise<void> {
    if (this._isRecording) return;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: this.options.sampleRate,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      this.audioContext = new AudioContext({ sampleRate: this.options.sampleRate });
      this._actualSampleRate = this.audioContext.sampleRate;

      console.log(
        `[AudioCapture] Requested sample rate: ${this.options.sampleRate}, actual: ${this._actualSampleRate}`,
      );

      this.source = this.audioContext.createMediaStreamSource(this.stream);

      // ScriptProcessorNode with buffer size of 4096 samples
      // At 16kHz, this fires every ~256ms (4096/16000)
      this.workletNode = this.audioContext.createScriptProcessor(4096, 1, 1);

      let chunkCount = 0;
      this.workletNode.onaudioprocess = (event: AudioProcessingEvent) => {
        if (!this._isRecording) return;

        const inputData = event.inputBuffer.getChannelData(0);
        const int16 = float32ToInt16(inputData);
        const base64 = int16ToBase64(int16);
        chunkCount++;
        if (chunkCount <= 3) {
          console.log(`[AudioCapture] Chunk #${chunkCount}, base64 len=${base64.length}, samples=${inputData.length}`);
        }
        this.options.onChunk(base64);
      };

      this.source.connect(this.workletNode);
      this.workletNode.connect(this.audioContext.destination);

      this._isRecording = true;
      console.log('[AudioCapture] Recording started');
    } catch (err) {
      this.cleanup();
      const error = err instanceof Error ? err : new Error(String(err));
      this.options.onError(error);
      throw error;
    }
  }

  /** Stop capturing audio and release resources */
  stop(): void {
    console.log('[AudioCapture] Recording stopped');
    this._isRecording = false;
    this.cleanup();
  }

  private cleanup(): void {
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode.onaudioprocess = null;
      this.workletNode = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
  }
}
