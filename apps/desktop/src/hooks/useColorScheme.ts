/**
 * useColorScheme - Manages theme based on settings and system preference
 */

import { useEffect, useLayoutEffect, useState } from 'react';
import { setTheme as setAppTheme } from '@tauri-apps/api/app';
import { useSettingsStore, type ColorScheme } from '../stores/settingsStore';

/**
 * Get the resolved theme (light or dark) based on color scheme setting.
 */
function getResolvedTheme(scheme: ColorScheme, prefersDark: boolean): 'light' | 'dark' {
  if (scheme === 'system') {
    return prefersDark ? 'dark' : 'light';
  }
  return scheme;
}

function hasTauriRuntime(): boolean {
  return typeof window !== 'undefined' && (
    '__TAURI_INTERNALS__' in window ||
    '__TAURI__' in window
  );
}

/**
 * Hook that manages the color scheme.
 * Reads from settings store and listens to system preference when set to "system".
 * Applies/removes the .dark class on <html>.
 */
export function useColorScheme(): 'light' | 'dark' {
  const colorScheme = useSettingsStore((s) => s.general.colorScheme);

  // Track system preference
  const [prefersDark, setPrefersDark] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // Listen for system preference changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent) => {
      setPrefersDark(e.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Calculate resolved theme
  const resolvedTheme = getResolvedTheme(colorScheme, prefersDark);

  // Apply to <html>
  useLayoutEffect(() => {
    const html = document.documentElement;
    if (resolvedTheme === 'dark') {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
    html.style.colorScheme = resolvedTheme;
    html.dataset.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    if (!hasTauriRuntime()) return;

    setAppTheme(resolvedTheme).catch((error) => {
      console.warn('Failed to sync native app theme:', error);
    });
  }, [resolvedTheme]);

  return resolvedTheme;
}
