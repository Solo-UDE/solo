import { motion, useReducedMotion } from 'framer-motion';

import type { FC } from 'react';

export interface StreamingIndicatorProps {
  className?: string;
}

export const StreamingIndicator: FC<StreamingIndicatorProps> = ({ className = '' }) => {
  const prefersReduced = useReducedMotion();

  if (prefersReduced) {
    return (
      <div className={`flex items-center gap-1.5 h-6 ${className}`}>
        <span className="text-xs text-muted-foreground">Thinking...</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-1 h-6 ${className}`} aria-label="Agent is thinking">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60"
          animate={{ opacity: [0.3, 1, 0.3], scale: [0.85, 1, 0.85] }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            delay: i * 0.2,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
};
