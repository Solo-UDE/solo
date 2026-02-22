import { useEffect, useRef } from 'react';

/**
 * Plays ambient background audio on the WelcomeScreen for 10 seconds, then
 * fades out. If the user opens a project before the 10s elapses, the audio
 * fades out immediately on unmount.
 *
 * Only plays once per session — returning to the welcome screen after closing
 * a workspace will not replay the sound.
 *
 * Respects `prefers-reduced-motion`.
 */

let hasPlayedThisSession = false;

const DURATION_MS = 5_000;
const FADE_OUT_MS = 3_000;
const FADE_STEPS = 1000;

export const useStartupSound = () => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fadeRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (hasPlayedThisSession) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      hasPlayedThisSession = true;
      return;
    }

    // Defer the guard flag so StrictMode's second mount can still play.
    // StrictMode: mount → unmount (clears deferred set) → remount (flag still false).
    const guardTimer = window.setTimeout(() => {
      hasPlayedThisSession = true;
    }, 0);

    const audio = new Audio('/sounds/ambient-drone.mp3');
    audio.volume = 0.5;
    audioRef.current = audio;

    const fadeOut = () => {
      const el = audioRef.current;
      if (!el) return;

      // Already fading — don't stack intervals
      if (fadeRef.current !== null) return;

      const startVol = el.volume;
      const stepMs = FADE_OUT_MS / FADE_STEPS;
      const volStep = startVol / FADE_STEPS;
      let step = 0;

      fadeRef.current = window.setInterval(() => {
        step++;
        el.volume = Math.max(0, startVol - volStep * step);
        if (step >= FADE_STEPS) {
          if (fadeRef.current !== null) clearInterval(fadeRef.current);
          fadeRef.current = null;
          el.pause();
          el.src = '';
          audioRef.current = null;
        }
      }, stepMs);
    };

    audio.play().catch((err) => {
      console.warn('[startup-sound] Playback failed:', err);
    });

    // After (DURATION - FADE) ms, begin fading out
    timerRef.current = window.setTimeout(fadeOut, DURATION_MS - FADE_OUT_MS);

    return () => {
      clearTimeout(guardTimer);
      // Cancel the scheduled fade-out
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      // Cancel any in-progress fade interval
      if (fadeRef.current !== null) {
        clearInterval(fadeRef.current);
        fadeRef.current = null;
      }
      // Stop audio immediately
      const el = audioRef.current;
      if (el) {
        el.pause();
        el.src = '';
        audioRef.current = null;
      }
    };
  }, []);
};
