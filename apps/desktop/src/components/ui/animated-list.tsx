/**
 * AnimatedList — Motion wrapper for staggered list entrance animations.
 * Wrap any list of items to get cascading fade+slide on mount.
 */

import { type ReactElement } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface AnimatedListProps {
  /** Each child MUST have a unique `key` prop */
  children: ReactElement[];
  className?: string;
  /** Delay between each item in seconds. Default: 0.03 (30ms) */
  stagger?: number;
  /** Slide distance in px. Default: 6 */
  slideY?: number;
  /** Whether to animate item exits. Default: false */
  animateExit?: boolean;
}

const containerVariants = {
  hidden: {},
  visible: (stagger: number) => ({
    transition: { staggerChildren: stagger },
  }),
};

const itemVariants = {
  hidden: (slideY: number) => ({
    opacity: 0,
    y: slideY,
  }),
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: 'spring' as const,
      stiffness: 500,
      damping: 30,
    },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.1 },
  },
};

export function AnimatedList({
  children,
  className,
  stagger = 0.03,
  slideY = 6,
  animateExit = false,
}: AnimatedListProps) {
  return (
    <motion.div
      className={className}
      variants={containerVariants}
      custom={stagger}
      initial="hidden"
      animate="visible"
    >
      <AnimatePresence>
        {children.map((child) => (
          <motion.div
            key={child.key}
            custom={slideY}
            variants={itemVariants}
            exit={animateExit ? itemVariants.exit : undefined}
          >
            {child}
          </motion.div>
        ))}
      </AnimatePresence>
    </motion.div>
  );
}
