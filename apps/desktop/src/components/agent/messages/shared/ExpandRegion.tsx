/**
 * Expand/collapse region with Orbit's snap-open motion pattern.
 *
 * Wraps children in AnimatePresence + motion.div so height + opacity
 * animate per TOOL_EXPAND_ENTER / TOOL_EXPAND_EXIT. Respects
 * prefers-reduced-motion via useReducedMotion().
 *
 * Usage:
 *   <ExpandRegion isExpanded={isExpanded}>
 *     {/* content renders only when expanded *\/}
 *   </ExpandRegion>
 */

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

import { TOOL_EXPAND_ENTER, TOOL_EXPAND_EXIT, TOOL_EXPAND_TRANSITION_NONE } from './motion-constants';

import type { FC, ReactNode } from 'react';

interface ExpandRegionProps {
  readonly isExpanded: boolean;
  readonly children: ReactNode;
}

export const ExpandRegion: FC<ExpandRegionProps> = ({ isExpanded, children }) => {
  const shouldReduceMotion = useReducedMotion();

  return (
    <AnimatePresence initial={false}>
      {isExpanded ? (
        <motion.div
          initial={shouldReduceMotion ? false : { height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={
            shouldReduceMotion
              ? { opacity: 0 }
              : { height: 0, opacity: 0, transition: TOOL_EXPAND_EXIT }
          }
          transition={shouldReduceMotion ? TOOL_EXPAND_TRANSITION_NONE : TOOL_EXPAND_ENTER}
          style={{ overflow: 'hidden' }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
