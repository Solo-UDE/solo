import { useState, useEffect, useRef } from 'react';

interface DelayedLoadingOptions {
  /** ms before showing skeleton (prevents flash on fast IPC). Default: 200 */
  showDelay?: number;
  /** ms minimum skeleton is visible once shown. Default: 400 */
  minVisible?: number;
}

/**
 * Vercel-style loading timing hook.
 *
 * - If loading resolves within showDelay, skeleton is NEVER shown
 * - Once shown, skeleton stays for at least minVisible ms
 * - Prevents jarring flash-of-skeleton on fast Tauri IPC calls
 *
 * Usage:
 *   const showSkeleton = useDelayedLoading(isLoading);
 *   if (showSkeleton) return <Skeleton />;
 */
export function useDelayedLoading(
  isLoading: boolean,
  options: DelayedLoadingOptions = {},
): boolean {
  const { showDelay = 200, minVisible = 400 } = options;
  const [showSkeleton, setShowSkeleton] = useState(false);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const visibleSinceRef = useRef<number>(0);

  useEffect(() => {
    if (isLoading) {
      // Start delay timer — only show skeleton if still loading after showDelay
      showTimerRef.current = setTimeout(() => {
        setShowSkeleton(true);
        visibleSinceRef.current = Date.now();
      }, showDelay);
    } else {
      // Loading finished — clear the delay timer if it hasn't fired
      clearTimeout(showTimerRef.current);

      if (visibleSinceRef.current > 0) {
        // Skeleton was shown — ensure minimum visible time
        const elapsed = Date.now() - visibleSinceRef.current;
        const remaining = minVisible - elapsed;

        if (remaining > 0) {
          const hideTimer = setTimeout(() => {
            setShowSkeleton(false);
            visibleSinceRef.current = 0;
          }, remaining);
          return () => clearTimeout(hideTimer);
        }
      }

      setShowSkeleton(false);
      visibleSinceRef.current = 0;
    }

    return () => clearTimeout(showTimerRef.current);
  }, [isLoading, showDelay, minVisible]);

  return showSkeleton;
}
