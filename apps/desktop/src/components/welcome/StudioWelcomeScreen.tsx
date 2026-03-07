/**
 * StudioWelcomeScreen - Welcome screen variant for Studio mode.
 * Shows Solo branding with "Your business automation agent" tagline.
 */

import { useState, useEffect, useCallback } from 'react';
import { ChatTeardrop } from '@phosphor-icons/react';
import { Button } from '@solo/ui';
import SoloDecryptAnimation from '../agent/SoloDecryptAnimation';
import { useAgentStore } from '@/stores/agentStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import { BUILTIN_PANEL_TYPES } from '@/lib/panels';

export function StudioWelcomeScreen() {
  const [showContent, setShowContent] = useState(false);
  const createSession = useAgentStore((s) => s.createSession);

  useEffect(() => {
    const t = setTimeout(() => setShowContent(true), 2400);
    return () => clearTimeout(t);
  }, []);

  const handleNewSession = useCallback(() => {
    createSession().then((sessionId) => {
      if (sessionId) {
        usePanelTabsStore.getState().openPanel(BUILTIN_PANEL_TYPES.AGENT, { sessionId });
      }
    }).catch((err: unknown) => {
      console.error('Failed to create session:', err);
    });
  }, [createSession]);

  return (
    <div className="relative bg-background flex-1 flex flex-col items-center justify-center h-full overflow-hidden select-none">
      {/* Animated glow */}
      <div
        className="absolute top-[30%] left-1/2 rounded-full pointer-events-none startup-glow"
        style={{
          width: 300,
          height: 300,
          background: 'radial-gradient(circle, var(--primary) 0%, transparent 70%)',
          filter: 'blur(90px)',
        }}
      />

      <SoloDecryptAnimation />

      <p className="text-xs text-muted-foreground/50 tracking-wide mt-4">
        Your business automation agent
      </p>

      <div
        className="flex items-center gap-3 mt-8"
        style={{
          opacity: showContent ? 1 : 0,
          transform: showContent ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity 280ms var(--ease-smooth), transform 280ms var(--ease-smooth)',
        }}
      >
        <Button
          variant="primary"
          size="sm"
          onClick={handleNewSession}
          className="text-xs shadow-sm"
        >
          <ChatTeardrop className="w-3.5 h-3.5" weight="duotone" />
          New Session
        </Button>
      </div>

      <div
        className="absolute bottom-4 text-[10px] text-muted-foreground/30"
        style={{
          opacity: showContent ? 1 : 0,
          transition: 'opacity 400ms var(--ease-smooth) 200ms',
        }}
      >
        v0.1.0
      </div>
    </div>
  );
}
