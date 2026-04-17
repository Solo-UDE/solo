// Radius tokens — Codex applies a 1.25× multiplier to its base radii
// (discovered in the design-dump: every --radius-X is `calc(base × 1.25)`).
// Adopting that multiplier gives Solo the same visual "roundness" as Codex.
//
// base values match Tailwind defaults; final values are base × 1.25.

const MULT = 1.25;

export const radiiBaseTokens = {
  none: '0',
  '2xs':'0.125rem', // 2px
  xs:   '0.25rem',  // 4px
  sm:   '0.375rem', // 6px
  md:   '0.5rem',   // 8px
  lg:   '0.625rem', // 10px
  xl:   '0.75rem',  // 12px
  '2xl':'1rem',     // 16px
  '3xl':'1.25rem',  // 20px
  '4xl':'1.5rem',   // 24px
} as const;

function withMult(base: string): string {
  if (base === '0') return '0';
  // Preserve rem-based authoring so arithmetic stays visible in DevTools
  return `calc(${base} * ${MULT})`;
}

export const radiiTokens = {
  none: '0',
  '2xs':withMult(radiiBaseTokens['2xs']), // 2.5px
  xs:   withMult(radiiBaseTokens.xs),     // 5px
  sm:   withMult(radiiBaseTokens.sm),     // 7.5px
  md:   withMult(radiiBaseTokens.md),     // 10px
  lg:   withMult(radiiBaseTokens.lg),     // 12.5px
  xl:   withMult(radiiBaseTokens.xl),     // 15px
  '2xl':withMult(radiiBaseTokens['2xl']), // 20px
  '3xl':withMult(radiiBaseTokens['3xl']), // 25px
  '4xl':withMult(radiiBaseTokens['4xl']), // 30px
  full: '9999px',

  // Base ring used by the concentric pattern (rounded-(--radius) p-(--padding))
  base: '0.5rem',     // 8px — Solo's concentric anchor stays at 8
} as const;

export type RadiusName = keyof typeof radiiTokens;
