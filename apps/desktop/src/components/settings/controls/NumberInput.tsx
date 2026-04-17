/**
 * NumberInput - Numeric value input with min/max bounds
 * Updated with sharp corners and improved styling
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
    const newValue = Math.min(max, value + step);
    onChange(newValue);
  }, [value, max, step, onChange]);

  const handleDecrement = useCallback(() => {
    const newValue = Math.max(min, value - step);
    onChange(newValue);
  }, [value, min, step, onChange]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      const parsed = parseInt(raw, 10);
      if (!isNaN(parsed)) {
        const clamped = Math.max(min, Math.min(max, parsed));
        onChange(clamped);
      }
    },
    [min, max, onChange]
  );

  return (
    <div className="inline-flex items-center">
      <button
        type="button"
        onClick={handleDecrement}
        disabled={disabled || value <= min}
        className={cn(
          "rounded-l-[8px] border border-r-0 border-border bg-muted px-2.5 py-1.5",
          "hover:bg-muted/80",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "transition-colors cursor-pointer"
        )}
      >
        <MinusIcon className="w-3 h-3" />
      </button>
      <input
        type="number"
        value={value}
        onChange={handleChange}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        style={{ width: `${Math.max(4, String(max).length + 2)}ch` }}
        className={cn(
          "px-2 py-1.5 text-center text-sm tabular-nums",
          "border-y border-border bg-background text-foreground",
          "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-inset",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        )}
      />
      <button
        type="button"
        onClick={handleIncrement}
        disabled={disabled || value >= max}
        className={cn(
          "rounded-r-[8px] border border-l-0 border-border bg-muted px-2.5 py-1.5",
          "hover:bg-muted/80",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "transition-colors cursor-pointer"
        )}
      >
        <PlusIcon className="w-3 h-3" />
      </button>
    </div>
  );
}
