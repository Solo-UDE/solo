/**
 * Repo Identity System
 * Each repo gets a unique icon + color pair for visual identification
 * across the rail, tab groups, and agent chat tabs.
 */

import {
  StarIcon,
  CircleIcon,
  HeartIcon,
  CubeIcon,
  MoonIcon,
  SunIcon,
} from '@radix-ui/react-icons';
import {
  Hexagon,
  Zap,
  Flower2,
  Crown,
  Atom,
  Orbit,
  Droplet,
  Flame,
  Leaf,
  Snowflake,
  Shield,
  Sparkle,
  Triangle,
  Diamond,
} from 'lucide-react';

/** Unified icon type — both Radix and Lucide icons accept className + style. */
export type RepoIcon = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;

// ---------------------------------------------------------------------------
// Icon pool - 20 curated abstract shapes (Radix + Lucide)
// ---------------------------------------------------------------------------

export const REPO_ICON_POOL = [
  'Hexagon',
  'Star',
  'Diamond',
  'Circle',
  'Triangle',
  'Lightning',
  'Heart',
  'Flower',
  'Crown',
  'Atom',
  'Planet',
  'Cube',
  'Drop',
  'Flame',
  'Leaf',
  'Moon',
  'Sun',
  'Snowflake',
  'Shield',
  'Sparkle',
] as const;

export type RepoIconName = (typeof REPO_ICON_POOL)[number];

const ICON_MAP: Record<RepoIconName, RepoIcon> = {
  Hexagon,
  Star: StarIcon,
  Diamond,
  Circle: CircleIcon,
  Triangle,
  Lightning: Zap,
  Heart: HeartIcon,
  Flower: Flower2,
  Crown,
  Atom,
  Planet: Orbit,
  Cube: CubeIcon,
  Drop: Droplet,
  Flame,
  Leaf,
  Moon: MoonIcon,
  Sun: SunIcon,
  Snowflake,
  Shield,
  Sparkle,
};

// ---------------------------------------------------------------------------
// Color pool - 10 distinct OKLCH hues
// Each color token maps to CSS custom properties defined in index.css.
// ---------------------------------------------------------------------------

export const REPO_COLOR_POOL = [
  'blue',
  'orange',
  'emerald',
  'violet',
  'rose',
  'amber',
  'cyan',
  'teal',
  'pink',
  'lime',
] as const;

export type RepoColorName = (typeof REPO_COLOR_POOL)[number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns the icon component for a given icon name. */
export function getRepoIcon(iconName: string): RepoIcon {
  return ICON_MAP[iconName as RepoIconName] ?? Hexagon;
}

/** Returns the CSS variable name for a repo color (base). */
export function getRepoColorVar(colorName: string): string {
  return `var(--repo-${colorName})`;
}

/** Returns the CSS variable name for a repo color (muted / background). */
export function getRepoColorMutedVar(colorName: string): string {
  return `var(--repo-${colorName}-muted)`;
}

/** Returns the CSS variable name for a repo color (foreground / text). */
export function getRepoColorFgVar(colorName: string): string {
  return `var(--repo-${colorName}-fg)`;
}

/**
 * Pick a random icon from the pool, preferring icons not yet used.
 * @param usedIcons - icon names already assigned to other repos
 */
export function pickRandomIcon(usedIcons: string[]): RepoIconName {
  const available = REPO_ICON_POOL.filter((i) => !usedIcons.includes(i));
  const pool = available.length > 0 ? available : REPO_ICON_POOL;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Pick a random color from the pool, preferring colors not yet used.
 * @param usedColors - color names already assigned to other repos
 */
export function pickRandomColor(usedColors: string[]): RepoColorName {
  const available = REPO_COLOR_POOL.filter((c) => !usedColors.includes(c));
  const pool = available.length > 0 ? available : REPO_COLOR_POOL;
  return pool[Math.floor(Math.random() * pool.length)];
}
