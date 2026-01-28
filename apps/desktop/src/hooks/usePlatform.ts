/**
 * usePlatform - Detect OS and provide platform-specific values
 */

import { useState, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

export type Platform = 'macos' | 'windows' | 'linux' | 'unknown';

interface PlatformInfo {
  platform: Platform;
  isMac: boolean;
  isWindows: boolean;
  isLinux: boolean;
  isFullscreen: boolean;
  // Titlebar insets to avoid native window controls
  titlebarInset: {
    left: number;
    right: number;
  };
}

const DEFAULT_INFO: PlatformInfo = {
  platform: 'unknown',
  isMac: false,
  isWindows: false,
  isLinux: false,
  isFullscreen: false,
  titlebarInset: { left: 0, right: 0 },
};

function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('win')) return 'windows';
  if (ua.includes('linux')) return 'linux';
  return 'unknown';
}

// Cached platform (doesn't change during runtime)
const cachedPlatform: Platform = detectPlatform();

export function usePlatform(): PlatformInfo {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | null = null;

    async function init() {
      // Check initial fullscreen state
      try {
        const fs = await appWindow.isFullscreen();
        setIsFullscreen(fs);
      } catch {
        // Ignore if not available
      }

      // Listen for resize events to detect fullscreen changes
      try {
        unlisten = await appWindow.onResized(async () => {
          const fs = await appWindow.isFullscreen();
          setIsFullscreen(fs);
        });
      } catch {
        // Ignore if not available
      }
    }

    init();

    return () => {
      unlisten?.();
    };
  }, []);

  const isMac = cachedPlatform === 'macos';
  const isWindows = cachedPlatform === 'windows';
  const isLinux = cachedPlatform === 'linux';

  return {
    platform: cachedPlatform,
    isMac,
    isWindows,
    isLinux,
    isFullscreen,
    titlebarInset: {
      // No insets needed in fullscreen - traffic lights are hidden
      left: isMac && !isFullscreen ? 70 : 0,
      right: (isWindows || isLinux) && !isFullscreen ? 140 : 0,
    },
  };
}

/**
 * Hook that returns dynamic titlebar padding style.
 */
export function useTitlebarStyle(): React.CSSProperties {
  const { titlebarInset } = usePlatform();

  return {
    paddingLeft: titlebarInset.left || 16,
    paddingRight: titlebarInset.right || 16,
  };
}
