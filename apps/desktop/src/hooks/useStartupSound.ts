import { useEffect, useRef } from 'react';

/**
 * Plays ambient background audio while the WelcomeScreen is mounted.
 *
 * The audio loops continuously and fades out over 500ms when the component
 * unmounts (i.e. when the user opens a project). Uses HTMLAudioElement
 * which Tauri's WKWebView allows to autoplay without a user gesture.
 *
 * Only plays once per session — if the user returns to the welcome screen
 * (e.g. by closing a workspace), the ambient audio does not restart.
 *
 * Respects `prefers-reduced-motion`.
 */

let hasPlayedThisSession = false;

const FADE_OUT_MS = 500;

export const useStartupSound = () => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fadeRef = useRef<number | null>(null);

  useEffect(() => {
    if (hasPlayedThisSession) return;
    hasPlayedThisSession = true;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const audio = new Audio('/sounds/ambient-drone.mp3');
    audio.volume = 0.5;
    audio.loop = true;
    audioRef.current = audio;

    audio.play().catch((err) => {
      console.warn('[startup-sound] Playback failed:', err);
    });

    return () => {
      // Fade out smoothly instead of abrupt stop
      const el = audioRef.current;
      if (!el) return;

      const startVol = el.volume;
      const steps = 20;
      const stepMs = FADE_OUT_MS / steps;
      const volStep = startVol / steps;
      let current = 0;

      fadeRef.current = window.setInterval(() => {
        current++;
        el.volume = Math.max(0, startVol - volStep * current);
        if (current >= steps) {
          if (fadeRef.current !== null) clearInterval(fadeRef.current);
          el.pause();
          el.src = '';
          audioRef.current = null;
        }
      }, stepMs);
    };
  }, []);

  // Clean up interval on unmount if fade is still running
  useEffect(() => {
    return () => {
      if (fadeRef.current !== null) {
        clearInterval(fadeRef.current);
      }
    };
  }, []);
};
