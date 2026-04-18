import { useState, useEffect } from 'react';
import { Info, X } from 'lucide-react';

import type { FC } from 'react';

export interface OpenAICapabilityBannerProps {
  /** Session ID — used as a key so dismissal is per-session. */
  sessionId: string;
}

const DISMISSED_KEY = 'solo.openai-banner-dismissed';

/**
 * Subtle banner shown above the chat input when an OpenAI model is
 * selected. Reminds the user that tool-calling features don't work on
 * OpenAI sessions yet (v1 limitation from Plan 3).
 *
 * Dismissible per-session: once the user clicks X, the banner stays
 * hidden for that sessionId. Refreshing the app brings it back for
 * other sessions.
 */
export const OpenAICapabilityBanner: FC<OpenAICapabilityBannerProps> = ({ sessionId }) => {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DISMISSED_KEY);
      const dismissedSessions: string[] = raw ? JSON.parse(raw) : [];
      setDismissed(dismissedSessions.includes(sessionId));
    } catch {
      setDismissed(false);
    }
  }, [sessionId]);

  const handleDismiss = () => {
    try {
      const raw = sessionStorage.getItem(DISMISSED_KEY);
      const dismissedSessions: string[] = raw ? JSON.parse(raw) : [];
      if (!dismissedSessions.includes(sessionId)) {
        dismissedSessions.push(sessionId);
        sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissedSessions));
      }
    } catch {
      // sessionStorage may be unavailable — fall back to in-memory only.
    }
    setDismissed(true);
  };

  if (dismissed) return null;

  return (
    <div className="mx-2 mb-1 flex items-center gap-2 px-2 py-1.5 rounded-none bg-muted/40 border border-border/60 text-xs text-muted-foreground">
      <Info className="w-3.5 h-3.5 flex-shrink-0" />
      <span className="flex-1">
        OpenAI chat is text-only in this build. Switch to Claude if you need file
        edits or tool use.
      </span>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="p-0.5 hover:text-foreground transition-colors"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
};
