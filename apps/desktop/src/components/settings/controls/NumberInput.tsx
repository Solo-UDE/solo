/**
 * NumberInput — segmented numeric stepper. Shares the Button size ladder so
 * it lines up with form controls at the same row height.
 *
 * Layout: single rounded-md container with a subtle ring, three columns
 * (decrement, value, increment). The input sits flat in the middle with no
 * inner border — the outer ring owns the frame. This prevents the "box in a
 * box" visual overflow the earlier border-y + border-l-0/r-0 pattern caused
 * once the global radius scale shifted.
 */

import { useCallback } from 'react';
import { MinusIcon, PlusIcon } from '@radix-ui/react-icons';
import { cn } from '../../../lib/utils';

interface NumberInputProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

export function NumberInput({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  disabled = false,
}: NumberInputProps) {
  const handleIncrement = useCallback(() => {
    onChange(Math.min(max, value + step));
  }, [value, max, step, onChange]);

  const handleDecrement = useCallback(() => {
    onChange(Math.max(min, value - step));
  }, [value, min, step, onChange]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const parsed = parseInt(e.target.value, 10);
      if (!isNaN(parsed)) {
        onChange(Math.max(min, Math.min(max, parsed)));
      }
    },
    [min, max, onChange]
  );

  const widthCh = Math.max(3, String(max).length + 1);

  return (
    <div
      className={cn(
        'inline-flex h-8 items-stretch overflow-hidden rounded-md',
        'bg-input ring-1 ring-black/5 dark:ring-white/10',
        'focus-within:ring-2 focus-within:ring-ring/40',
        'transition-[box-shadow] duration-100',
        disabled && 'opacity-50 pointer-events-none'
      )}
    >
      <button
        type="button"
        onClick={handleDecrement}
        disabled={disabled || value <= min}
        aria-label="Decrement"
        className={cn(
          'flex w-7 items-center justify-center text-muted-foreground',
          'hover:bg-accent hover:text-foreground',
          'disabled:cursor-not-allowed disabled:opacity-40',
          'transition-colors cursor-pointer'
        )}
      >
        <MinusIcon className="h-3 w-3" />
      </button>
      <input
        type="number"
        value={value}
        onChange={handleChange}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        style={{ width: `${widthCh}ch` }}
        className={cn(
          'min-w-0 flex-none px-1 text-center text-[13px] tabular-nums',
          'bg-transparent text-foreground',
          'focus:outline-none',
          'disabled:cursor-not-allowed',
          '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
        )}
      />
      <button
        type="button"
        onClick={handleIncrement}
        disabled={disabled || value >= max}
        aria-label="Increment"
        className={cn(
          'flex w-7 items-center justify-center text-muted-foreground',
          'hover:bg-accent hover:text-foreground',
          'disabled:cursor-not-allowed disabled:opacity-40',
          'transition-colors cursor-pointer'
        )}
      >
        <PlusIcon className="h-3 w-3" />
      </button>
    </div>
  );
}
