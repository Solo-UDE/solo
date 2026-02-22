/**
 * PCM audio conversion utilities for ElevenLabs voice integration
 *
 * Handles Float32 <-> Int16 PCM conversion and base64 encoding/decoding
 * required for WebSocket audio streaming.
 */

/** Convert Float32Array (Web Audio API format) to Int16Array (PCM format for ElevenLabs) */
export function float32ToInt16(samples: Float32Array): Int16Array {
  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    // Clamp to [-1, 1] range then scale to Int16 range
    const s = Math.max(-1, Math.min(1, samples[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

/** Convert Int16Array back to Float32Array (for AudioContext playback) */
export function int16ToFloat32(pcm: Int16Array): Float32Array {
  const float32 = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    float32[i] = pcm[i] / (pcm[i] < 0 ? 0x8000 : 0x7fff);
  }
  return float32;
}

/** Encode Int16Array as base64 string for Tauri IPC transport */
export function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Decode base64 string back to Int16Array (for TTS playback) */
export function base64ToInt16(b64: string): Int16Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  // PCM16 = 2 bytes per sample. HTTP chunking can split at odd byte
  // boundaries, so trim any trailing byte that isn't a complete sample.
  const usableLength = bytes.byteLength & ~1;
  return new Int16Array(bytes.buffer, 0, usableLength / 2);
}
