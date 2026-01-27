/**
 * useColorScheme - Manages theme based on settings and system preference
 */

import { useEffect, useState } from 'react';
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
  useEffect(() => {
    const html = document.documentElement;
    if (resolvedTheme === 'dark') {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
  }, [resolvedTheme]);

  return resolvedTheme;
}
