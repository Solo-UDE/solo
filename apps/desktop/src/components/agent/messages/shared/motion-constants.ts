/**
 * Shared animation constants for tool card widgets.
 *
 * Enter: critically-damped spring on height for snap-open feel.
 *        Opacity leads at 100ms so content appears as the container opens.
 * Exit:  smooth ease-out-quart (200ms) — gentle collapse without snapping.
 *
 * AnimatePresence stays in its default (sync) mode — mode="wait" would queue
 * exit→enter sequentially and spike CPU when many tools complete at once.
 *
 * Ported verbatim from Orbit/apps/agent/src/components/chat/tools/shared/constants.ts
 */

import type { Transition } from 'motion/react';

/** ease-out-expo as cubic-bezier array. CSS equiv: cubic-bezier(0.19, 1, 0.22, 1) */
const EASE_OUT_EXPO: [number, number, number, number] = [0.19, 1, 0.22, 1];

/** ease-out-quart — gentler deceleration than expo. CSS equiv: cubic-bezier(0.25, 1, 0.5, 1) */
const EASE_OUT_QUART: [number, number, number, number] = [0.25, 1, 0.5, 1];

/** Snap-open enter transition — spring height + fast opacity fade-in. */
export const TOOL_EXPAND_ENTER: Transition = {
  height: { type: 'spring', duration: 0.3, bounce: 0 },
  opacity: { duration: 0.1, ease: EASE_OUT_EXPO },
};

/** Smooth collapse exit transition — gentle ease-out-quart so it doesn't snap. */
export const TOOL_EXPAND_EXIT: Transition = {
  height: { duration: 0.2, ease: EASE_OUT_QUART },
  opacity: { duration: 0.15, ease: EASE_OUT_QUART },
};

/** Instant transition for users who prefer reduced motion. */
export const TOOL_EXPAND_TRANSITION_NONE: Transition = {
  duration: 0,
};
