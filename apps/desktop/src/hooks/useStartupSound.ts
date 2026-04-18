import { useEffect } from 'react';

/**
 * Plays ambient background audio on the WelcomeScreen, then fades out.
 * Opening a project calls `stopStartupSound()` which cuts it immediately.
 *
 * Plays once per launch. Respects `prefers-reduced-motion`.
 */

const SESSION_KEY = 'solo:startup-sound:played';
const DURATION_MS = 5_000;
const FADE_OUT_MS = 3_000;
const FADE_STEPS = 1000;

// Module-level singleton so the playback state survives React re-renders,
// StrictMode double-mounts, and Vite HMR swaps. This lets callers stop the
// audio imperatively without relying on component unmount timing.
let currentAudio: HTMLAudioElement | null = null;
let fadeInterval: number | null = null;
let fadeTimer: number | null = null;

const hasPlayedThisSession = () => {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
};

const markPlayed = () => {
  try {
    sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    /* sessionStorage may be unavailable — fall through */
  }
};

/**
 * Hard-stop any in-flight startup audio. Idempotent. Safe to call from
 * anywhere (e.g. a project-open handler) without waiting for a React unmount.
 */
export const stopStartupSound = () => {
  if (fadeTimer !== null) {
    clearTimeout(fadeTimer);
    fadeTimer = null;
  }
  if (fadeInterval !== null) {
    clearInterval(fadeInterval);
    fadeInterval = null;
  }
  const el = currentAudio;
  if (el) {
    el.pause();
    el.src = '';
    el.load(); // force-release the decoder so `pause()` can't race with `play()`
    currentAudio = null;
  }
};

export const useStartupSound = () => {
  useEffect(() => {
    if (hasPlayedThisSession()) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      markPlayed();
      return;
    }

    // Mark as played synchronously: StrictMode's second mount will see the
    // flag set and skip, so we only create one audio element per launch.
    markPlayed();

    // Defensive: kill any lingering element (HMR swap mid-playback).
    stopStartupSound();

    const audio = new Audio('/sounds/ambient-drone.mp3');
    audio.loop = false;
    audio.volume = 0.5;
    currentAudio = audio;

    audio.play().catch((err) => {
      console.warn('[startup-sound] Playback failed:', err);
    });

    const beginFade = () => {
      const el = currentAudio;
      if (!el || fadeInterval !== null) return;

      const startVol = el.volume;
      const stepMs = FADE_OUT_MS / FADE_STEPS;
      const volStep = startVol / FADE_STEPS;
      let step = 0;

      fadeInterval = window.setInterval(() => {
        step++;
        el.volume = Math.max(0, startVol - volStep * step);
        if (step >= FADE_STEPS) {
          stopStartupSound();
        }
      }, stepMs);
    };

    fadeTimer = window.setTimeout(beginFade, DURATION_MS - FADE_OUT_MS);

    return () => {
      // On unmount, cut immediately regardless of fade progress.
      stopStartupSound();
    };
  }, []);
};
