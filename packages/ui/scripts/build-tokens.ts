/**
 * Generator — reads packages/ui/src/tokens/*.ts and writes tokens.css.
 *
 * tokens.css is NEVER hand-edited. Run via:
 *   bun run --filter @solo/ui build-tokens
 *
 * Emission pattern (shadcn-style indirection — matches what the Solo app
 * already expects so existing `var(--card)` / `var(--sidebar)` references
 * keep working and dark-mode overrides cascade naturally):
 *
 *   @theme inline  → Tailwind theme registration; colors map `--color-X: var(--X)`
 *                    pointing at the raw name in :root. Other scales declare
 *                    directly for Tailwind utility resolution.
 *   :root          → raw values: `--background`, `--card`, `--radius-sm`, etc.
 *                    No `--color-*` prefix for colors; they are indirected.
 *   html.dark      → raw overrides for colors + shadows.
 *   @keyframes     → every keyframe from motion.ts.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  chromeTokens,
  colorTokens,
  glowPresets,
  motionTokens,
  radiiTokens,
  shadowTokens,
  spacingTokens,
  typographyTokens,
  zIndexTokens,
} from '../src/tokens';

function kebab(camel: string): string {
  return camel.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function buildThemeBlock(): string {
  const lines: string[] = ['@theme inline {'];

  lines.push('  /* Colors — Tailwind utilities resolve via var() indirection */');
  for (const name of Object.keys(colorTokens.light)) {
    const k = kebab(name);
    lines.push(`  --color-${k}: var(--${k});`);
  }
  lines.push('');

  lines.push('  /* Typography — font families */');
  for (const name of Object.keys(typographyTokens.fontFamily)) {
    const k = kebab(name);
    lines.push(`  --font-${k}: var(--font-${k});`);
  }
  lines.push('');

  lines.push('  /* Typography — font sizes */');
  for (const name of Object.keys(typographyTokens.fontSize)) {
    lines.push(`  --text-${name}: var(--text-${name});`);
  }
  lines.push('');

  lines.push('  /* Typography — weights / line-heights / tracking */');
  for (const name of Object.keys(typographyTokens.fontWeight)) {
    const k = kebab(name);
    lines.push(`  --font-weight-${k}: var(--font-weight-${k});`);
  }
  for (const name of Object.keys(typographyTokens.lineHeight)) {
    const k = kebab(name);
    lines.push(`  --leading-${k}: var(--leading-${k});`);
  }
  for (const name of Object.keys(typographyTokens.letterSpacing)) {
    const k = kebab(name);
    lines.push(`  --tracking-${k}: var(--tracking-${k});`);
  }
  lines.push('');

  lines.push('  /* Radii */');
  for (const name of Object.keys(radiiTokens)) {
    if (name === 'base') {
      lines.push(`  --radius: var(--radius);`);
    } else {
      const k = kebab(name);
      lines.push(`  --radius-${k}: var(--radius-${k});`);
    }
  }
  lines.push('');

  lines.push('  /* Shadows */');
  for (const name of Object.keys(shadowTokens.light)) {
    const k = kebab(name);
    lines.push(`  --shadow-${k}: var(--shadow-${k});`);
  }
  for (const name of Object.keys(glowPresets)) {
    const k = kebab(name);
    lines.push(`  --shadow-glow-${k}: var(--shadow-glow-${k});`);
  }
  lines.push('');

  lines.push('  /* Motion */');
  for (const name of Object.keys(motionTokens.duration)) {
    const k = kebab(name);
    lines.push(`  --duration-${k}: var(--duration-${k});`);
  }
  for (const name of Object.keys(motionTokens.easing)) {
    const k = kebab(name);
    lines.push(`  --ease-${k}: var(--ease-${k});`);
  }
  for (const name of Object.keys(motionTokens.animations)) {
    lines.push(`  --animate-${name}: var(--animate-${name});`);
  }
  lines.push('}');
  return lines.join('\n');
}

function buildRootLight(): string {
  const lines: string[] = [':root {'];
  lines.push('  color-scheme: light dark;');
  lines.push('');

  lines.push('  /* Colors (raw) — light */');
  for (const [name, value] of Object.entries(colorTokens.light)) {
    lines.push(`  --${kebab(name)}: ${value};`);
  }
  lines.push('');

  lines.push('  /* Typography — font families */');
  for (const [name, value] of Object.entries(typographyTokens.fontFamily)) {
    lines.push(`  --font-${kebab(name)}: ${value};`);
  }
  lines.push('');

  lines.push('  /* Typography — font sizes */');
  for (const [name, value] of Object.entries(typographyTokens.fontSize)) {
    lines.push(`  --text-${name}: ${value};`);
  }
  lines.push('');

  lines.push('  /* Typography — weights / line-heights / tracking */');
  for (const [name, value] of Object.entries(typographyTokens.fontWeight)) {
    lines.push(`  --font-weight-${kebab(name)}: ${value};`);
  }
  for (const [name, value] of Object.entries(typographyTokens.lineHeight)) {
    lines.push(`  --leading-${kebab(name)}: ${value};`);
  }
  for (const [name, value] of Object.entries(typographyTokens.letterSpacing)) {
    lines.push(`  --tracking-${kebab(name)}: ${value};`);
  }
  for (const [name, value] of Object.entries(typographyTokens.fontFeatureSettings)) {
    lines.push(`  --font-feature-${kebab(name)}: ${value};`);
  }
  lines.push('');

  lines.push('  /* Spacing (for JS consumers / arbitrary usage) */');
  for (const [name, value] of Object.entries(spacingTokens)) {
    const safe = String(name).replace('.', '_');
    lines.push(`  --space-${safe}: ${value};`);
  }
  lines.push('');

  lines.push('  /* Radii */');
  for (const [name, value] of Object.entries(radiiTokens)) {
    if (name === 'base') {
      lines.push(`  --radius: ${value};`);
    } else {
      lines.push(`  --radius-${kebab(name)}: ${value};`);
    }
  }
  lines.push('');

  lines.push('  /* Shadows (light) */');
  for (const [name, value] of Object.entries(shadowTokens.light)) {
    lines.push(`  --shadow-${kebab(name)}: ${value};`);
  }
  for (const [name, value] of Object.entries(glowPresets)) {
    lines.push(`  --shadow-glow-${kebab(name)}: ${value};`);
  }
  lines.push('');

  lines.push('  /* Motion */');
  for (const [name, value] of Object.entries(motionTokens.duration)) {
    lines.push(`  --duration-${kebab(name)}: ${value}ms;`);
  }
  for (const [name, value] of Object.entries(motionTokens.easing)) {
    lines.push(`  --ease-${kebab(name)}: ${value};`);
  }
  for (const [name, value] of Object.entries(motionTokens.animations)) {
    lines.push(`  --animate-${name}: ${value};`);
  }
  lines.push('');

  lines.push('  /* Z-index */');
  for (const [name, value] of Object.entries(zIndexTokens)) {
    lines.push(`  --z-${kebab(name)}: ${value};`);
  }
  lines.push('');

  lines.push('  /* Chrome — IDE-specific measurements (Codex-derived) */');
  for (const [name, value] of Object.entries(chromeTokens)) {
    lines.push(`  --chrome-${kebab(name)}: ${value};`);
  }

  lines.push('}');
  return lines.join('\n');
}

function buildRootDark(): string {
  const lines: string[] = ['html.dark {'];
  lines.push('  color-scheme: dark;');
  lines.push('');

  lines.push('  /* Colors (raw) — dark overrides */');
  for (const [name, value] of Object.entries(colorTokens.dark)) {
    lines.push(`  --${kebab(name)}: ${value};`);
  }
  lines.push('');

  lines.push('  /* Shadows — dark overrides */');
  for (const [name, value] of Object.entries(shadowTokens.dark)) {
    lines.push(`  --shadow-${kebab(name)}: ${value};`);
  }

  lines.push('}');
  return lines.join('\n');
}

function buildKeyframes(): string {
  return Object.values(motionTokens.keyframes).join('\n\n');
}

async function main() {
  const header = [
    '/*',
    ' * packages/ui/src/tokens.css',
    ' * GENERATED by packages/ui/scripts/build-tokens.ts — do not edit.',
    ' * Run `bun run --filter @solo/ui build-tokens` to regenerate.',
    ' */',
    '',
  ].join('\n');

  const content = [
    header,
    buildThemeBlock(),
    '',
    buildRootLight(),
    '',
    buildRootDark(),
    '',
    '/* Keyframes */',
    buildKeyframes(),
    '',
  ].join('\n');

  const outPath = join(import.meta.dir, '..', 'src', 'tokens.css');
  await writeFile(outPath, content, 'utf8');
  console.log(`[build-tokens] wrote ${outPath} (${content.length} bytes)`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
