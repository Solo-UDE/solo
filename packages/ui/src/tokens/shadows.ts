// Shadow tokens — elevation scale + glow presets.
//
// Skill deviation: skill says "Remove all shadows in dark mode."
// Solo softens instead; dark-mode shadows are necessary for floating
// panel elevation against the near-black canvas. Documented in
// skill-reconciliation.md.

interface ShadowSet {
  none: string;
  xs: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  glass: string;
  shell: string;
}

// Shadows ported from Codex extraction — flatter, single-stop elevation:
//   --shadow-md: 0px 2px 4px -1px #00000014 (8%)
//   --shadow-xl: 0px 8px 16px -4px #0000001f (12%)
//   --shadow-2xl: 0px 16px 32px -8px #00000030 (19%)
// Solo adds xs/sm/lg/glass/shell by interpolation to fill in gaps.
const light: ShadowSet = {
  none:  '0 0 #0000',
  xs:    '0 1px 2px 0 rgb(0 0 0 / 0.04)',
  sm:    '0 1px 2px -0.5px rgb(0 0 0 / 0.06)',
  md:    '0 2px 4px -1px rgb(0 0 0 / 0.08)',                                  // ← Codex --shadow-md
  lg:    '0 4px 8px -2px rgb(0 0 0 / 0.10)',                                  // interpolated
  xl:    '0 8px 16px -4px rgb(0 0 0 / 0.12)',                                 // ← Codex --shadow-xl
  glass: '0 16px 32px -8px rgb(0 0 0 / 0.19)',                                // ← Codex --shadow-2xl
  shell: '0 20px 48px -12px rgb(0 0 0 / 0.22), 0 6px 16px -8px rgb(0 0 0 / 0.10)', // overlay anchor
};

// Dark mode shadows: Codex has no explicit dark set (single scale). Solo keeps
// a slightly elevated version to maintain floating-panel legibility against
// the near-black canvas (skill deviation — see reconciliation.md).
const dark: ShadowSet = {
  none:  '0 0 #0000',
  xs:    '0 1px 2px 0 rgb(0 0 0 / 0.24)',
  sm:    '0 1px 2px -0.5px rgb(0 0 0 / 0.30)',
  md:    '0 2px 4px -1px rgb(0 0 0 / 0.34)',
  lg:    '0 4px 8px -2px rgb(0 0 0 / 0.38)',
  xl:    '0 8px 16px -4px rgb(0 0 0 / 0.42)',
  glass: '0 16px 32px -8px rgb(0 0 0 / 0.48)',
  shell: '0 20px 48px -12px rgb(0 0 0 / 0.55), 0 6px 16px -8px rgb(0 0 0 / 0.28)',
};

export const shadowTokens = { light, dark } as const;

// Glow presets — use color-mix at consumption site for dynamic theming
export const glowPresets = {
  primarySoft:
    '0 4px 16px -2px color-mix(in oklch, var(--primary) 25%, transparent), 0 0 0 1px color-mix(in oklch, var(--primary) 8%, transparent)',
  hoverLift:
    '0 4px 12px -2px rgb(0 0 0 / 0.10)',
  hoverLiftDark:
    '0 4px 12px -2px rgb(0 0 0 / 0.25)',
} as const;

export type ShadowName = keyof ShadowSet;
