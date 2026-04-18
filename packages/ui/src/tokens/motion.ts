// Motion tokens — durations + easings + keyframes.
//
// Easings carried forward from apps/desktop/src/index.css. `outQuart`
// is a new named alias for the cubic-bezier already used in streamdown overrides.

export const motionTokens = {
  duration: {
    instant: 0,
    fast:    100,
    base:    150,
    medium:  200,
    slow:    300,
    slower:  500,
  },

  easing: {
    spring:   'cubic-bezier(0.34, 1.56, 0.64, 1)',
    smooth:   'cubic-bezier(0.16, 1, 0.3, 1)',
    snappy:   'cubic-bezier(0.4, 0, 0.2, 1)',
    outQuart: 'cubic-bezier(0.165, 0.85, 0.45, 1)',
  },

  keyframes: {
    'fade-in-scale':
      '@keyframes fade-in-scale { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }',
    'fade-out':
      '@keyframes fade-out { from { opacity: 1; } to { opacity: 0; } }',
    'pop-in':
      '@keyframes pop-in { from { opacity: 0; transform: scale(0.9) translateY(4px); } to { opacity: 1; transform: scale(1) translateY(0); } }',
    'slide-up':
      '@keyframes slide-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }',
    'streaming-dot':
      '@keyframes streaming-dot { 0%,100% { opacity: 0.3; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1); } }',
    'shimmer':
      '@keyframes shimmer { 0% { background-position: 200% center; } 100% { background-position: -200% center; } }',
    'flow-token-in':
      '@keyframes flow-token-in { from { opacity: 0; } to { opacity: 1; } }',
    'collapsible-down':
      '@keyframes collapsible-down { from { height: 0; opacity: 0; } to { height: var(--radix-collapsible-content-height); opacity: 1; } }',
    'collapsible-up':
      '@keyframes collapsible-up { from { height: var(--radix-collapsible-content-height); opacity: 1; } to { height: 0; opacity: 0; } }',
    'spring-pop':
      '@keyframes spring-pop { 0% { transform: scale(0) rotate(-90deg); opacity: 0; } 60% { transform: scale(1.15) rotate(5deg); opacity: 1; } 80% { transform: scale(0.95) rotate(-2deg); } 100% { transform: scale(1) rotate(0deg); opacity: 1; } }',
    // Ported from Codex (codex-dialog-enter / codex-dialog-overlay)
    'dialog-enter':
      '@keyframes dialog-enter { 0% { opacity: 0; transform: translateY(calc(var(--radius-base, 0.5rem) * 0.25)) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }',
    'overlay-in':
      '@keyframes overlay-in { from { opacity: 0; } to { opacity: 1; } }',
    'loading-shimmer':
      '@keyframes loading-shimmer { 0% { background-position: -100% 0; } to { background-position: 250% 0; } }',
  },

  // Ready-to-use animation shorthands composed from the above
  animations: {
    'fade-in-scale':    'fade-in-scale 200ms cubic-bezier(0.16, 1, 0.3, 1)',
    'fade-out':         'fade-out 100ms cubic-bezier(0.4, 0, 0.2, 1)',
    'pop-in':           'pop-in 150ms cubic-bezier(0.34, 1.56, 0.64, 1)',
    'slide-up':         'slide-up 200ms cubic-bezier(0.16, 1, 0.3, 1)',
    'collapsible-down': 'collapsible-down 200ms cubic-bezier(0.16, 1, 0.3, 1)',
    'collapsible-up':   'collapsible-up 150ms cubic-bezier(0.16, 1, 0.3, 1)',
    'dialog-enter':     'dialog-enter 200ms cubic-bezier(0.16, 1, 0.3, 1)',
    'overlay-in':       'overlay-in 150ms cubic-bezier(0.4, 0, 0.2, 1)',
    'loading-shimmer':  'loading-shimmer 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite',
  },
} as const;

export type DurationName = keyof typeof motionTokens.duration;
export type EasingName = keyof typeof motionTokens.easing;
export type KeyframeName = keyof typeof motionTokens.keyframes;
