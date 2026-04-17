// Typography tokens — native macOS font stack (SF Pro), monospace for code,
// Atkinson Hyperlegible for chat prose.
//
// Skill deviation: Inspirations UI skill mandates Inter; Solo uses SF Pro for
// system-chrome consistency on macOS. Documented in skill-reconciliation.md.

export const typographyTokens = {
  fontFamily: {
    sans: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif',
    mono: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    chat: '"Atkinson Hyperlegible Next Variable", "Atkinson Hyperlegible Next", sans-serif',
  },

  fontSize: {
    '2xs':  '0.6875rem', // 11px — chrome labels, kbd chips
    xs:    '0.75rem',    // 12px — chrome body
    sm:    '0.8125rem',  // 13px — app baseline
    base:  '0.875rem',   // 14px — relaxed body
    md:    '1rem',       // 16px — form inputs
    lg:    '1.125rem',   // 18px
    xl:    '1.25rem',    // 20px
    '2xl': '1.5rem',     // 24px
    '3xl': '1.75rem',    // 28px
    '4xl': '2rem',       // 32px
    '5xl': '2.5rem',     // 40px
    '6xl': '3rem',       // 48px
  },

  fontWeight: {
    normal:   400,
    book:     430, // chat body — slightly heavier than normal, lighter than medium
    medium:   500,
    semibold: 600,
    bold:     700,
  },

  lineHeight: {
    tight:   1.2,
    normal:  1.5,
    chat:    1.68,
    relaxed: 1.8,
  },

  letterSpacing: {
    tight:  '-0.01em',
    normal: '0',
    wide:   '0.025em',
  },

  fontFeatureSettings: {
    default: '"rlig" 1, "calt" 1',
    chat:    '"rlig" 1, "calt" 1, "cv11" 1',
    tabular: '"tnum" 1',
  },
} as const;

export type FontSizeName = keyof typeof typographyTokens.fontSize;
export type FontWeightName = keyof typeof typographyTokens.fontWeight;
