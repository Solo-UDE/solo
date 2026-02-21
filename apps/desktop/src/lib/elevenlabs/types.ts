/** STT session status */
export type SttStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'recording'
  | 'ended'
  | 'error';

/** TTS session status */
export type TtsStatus =
  | 'idle'
  | 'speaking'
  | 'done'
  | 'error';
