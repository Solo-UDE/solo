import { useState, useEffect, useRef } from 'react';

/**
 * Hook that progressively reveals text content with a typewriter effect.
 * Only active during streaming — returns full content when not streaming.
 *
 * @param content The full content string
 * @param isStreaming Whether the message is currently streaming
 * @param charsPerTick Number of characters to reveal per tick (default 3)
 * @param intervalMs Tick interval in milliseconds (default 16 ~60fps)
 */
export const useStreamingText = (
  content: string,
  isStreaming: boolean,
  charsPerTick: number = 3,
  intervalMs: number = 16,
): string => {
  const [displayedLength, setDisplayedLength] = useState(content.length);
  const prevContentRef = useRef(content);
  const prevStreamingRef = useRef(isStreaming);

  // When streaming starts, initialize displayedLength to current content length
  // (so we only animate NEW content, not re-animate the whole thing)
  useEffect(() => {
    if (isStreaming && !prevStreamingRef.current) {
      // Streaming just started — set to current length (animate from here)
      setDisplayedLength(content.length);
    }
    if (!isStreaming && prevStreamingRef.current) {
      // Streaming just ended — snap to full content
      setDisplayedLength(content.length);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, content.length]);

  // When content changes and we're not streaming, snap to full length
  useEffect(() => {
    if (!isStreaming) {
      setDisplayedLength(content.length);
    }
    prevContentRef.current = content;
  }, [content, isStreaming]);

  // Progressive reveal interval during streaming
  useEffect(() => {
    if (!isStreaming || displayedLength >= content.length) return;

    const timer = setInterval(() => {
      setDisplayedLength((prev) => {
        const next = Math.min(prev + charsPerTick, content.length);
        if (next >= content.length) {
          clearInterval(timer);
        }
        return next;
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isStreaming, content.length, displayedLength, charsPerTick, intervalMs]);

  // If not streaming, always show full content
  if (!isStreaming) return content;

  return content.slice(0, displayedLength);
};
