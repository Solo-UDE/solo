import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { MinusIcon, PlusIcon } from '@radix-ui/react-icons';

import { cn } from '@/lib/utils';

export interface StepperProps {
  value?: number;
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  onChange?: (value: number) => void;
}

const digitVariants = {
  initial: (direction: number) => ({
    y: direction > 0 ? 12 : -12,
    opacity: 0,
    scale: 0.72,
    filter: 'blur(2px)',
  }),
  animate: {
    y: 0,
    opacity: 1,
    scale: 1,
    filter: 'blur(0px)',
  },
  exit: (direction: number) => ({
    y: direction > 0 ? -12 : 12,
    opacity: 0,
    scale: 0.72,
    filter: 'blur(2px)',
  }),
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function Stepper({
  value,
  defaultValue = 0,
  min = 0,
  max = 999,
  step = 1,
  disabled = false,
  className,
  onChange,
}: StepperProps) {
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = React.useState(defaultValue);
  const [direction, setDirection] = React.useState(0);

  const current = clamp(isControlled ? value : internalValue, min, max);
  const digits = String(current).split('');
  const digitCount = Math.max(2, String(min).length, String(max).length, digits.length);

  const update = (next: number) => {
    const clampedNext = clamp(next, min, max);
    if (clampedNext === current) return;

    setDirection(clampedNext > current ? 1 : -1);
    if (!isControlled) setInternalValue(clampedNext);
    onChange?.(clampedNext);
  };

  return (
    <div className={cn('inline-flex items-center justify-center', className)}>
      <div
        className={cn(
          'flex h-8 items-center gap-1 rounded-full border border-border/70 bg-background/70 p-0.5 shadow-sm',
          'transition-[background-color,border-color,box-shadow] duration-150',
          'focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20',
          disabled && 'pointer-events-none opacity-50',
        )}
      >
        <StepperButton
          label="Decrement"
          disabled={disabled || current <= min}
          onClick={() => update(current - step)}
        >
          <MinusIcon className="h-3.5 w-3.5" />
        </StepperButton>

        <div
          className="relative flex h-7 shrink-0 items-center justify-center gap-0.5 px-1 text-sm font-semibold tabular-nums text-foreground"
          style={{ minWidth: `${digitCount * 0.72 + 0.35}em` }}
          aria-live="polite"
        >
          {digits.map((digit, index) => (
            <span key={`${index}-${digits.length}`} className="relative h-5 w-[0.62em] overflow-hidden">
              <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                <motion.span
                  key={`${index}-${digit}-${current}`}
                  custom={direction}
                  variants={digitVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ type: 'spring', duration: 0.28, bounce: 0 }}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  {digit}
                </motion.span>
              </AnimatePresence>
            </span>
          ))}
        </div>

        <StepperButton
          label="Increment"
          disabled={disabled || current >= max}
          onClick={() => update(current + step)}
        >
          <PlusIcon className="h-3.5 w-3.5" />
        </StepperButton>
      </div>
    </div>
  );
}

function StepperButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      disabled={disabled}
      whileHover={disabled ? undefined : { scale: 1.05 }}
      whileTap={disabled ? undefined : { scale: 0.96 }}
      transition={{ type: 'spring', duration: 0.22, bounce: 0 }}
      onClick={onClick}
      className={cn(
        'flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full',
        'bg-muted/70 text-muted-foreground transition-[background-color,color,opacity] duration-150',
        'hover:bg-primary hover:text-primary-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35',
        'disabled:cursor-not-allowed disabled:opacity-40',
      )}
    >
      {children}
    </motion.button>
  );
}
