let scheduled = false;

type IdleCallback = (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void;

function scheduleIdle(callback: IdleCallback): void {
  const requestIdle = window.requestIdleCallback as ((cb: IdleCallback, options?: { timeout: number }) => number) | undefined;
  if (requestIdle) {
    requestIdle(callback, { timeout: 2500 });
    return;
  }
  window.setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 0 }), 800);
}

export function scheduleInteractionPrewarm(): void {
  if (scheduled || typeof window === 'undefined') return;
  scheduled = true;

  scheduleIdle(() => {
    void import('@monaco-editor/react');
    void import('@xterm/addon-web-links');
    void import('@/components/settings');
    void import('@/components/panels/vault/CurrentVaultPanel');
    void import('@/components/panels/vault/SkillsPanel');
    void import('@/components/panels/vault/TasksPanel');
  });
}

