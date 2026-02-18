/**
 * SelectDropdown - Enum selection control
 * Updated with sharp corners and improved styling
 */

import { CaretDown } from '@phosphor-icons/react';
import { cn } from '../../../lib/utils';

interface Option<T extends string | number> {
  label: string;
  value: T;
}

interface SelectDropdownProps<T extends string | number> {
  value: T;
  options: readonly Option<T>[] | Option<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}

export function SelectDropdown<T extends string | number>({
  value,
  options,
  onChange,
  disabled = false,
  className = '',
}: SelectDropdownProps<T>) {
  return (
    <div className={cn("relative", className)}>
      <select
        value={String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          // Handle numeric values
          const option = options.find((o) => String(o.value) === raw);
          if (option) {
            onChange(option.value);
          }
        }}
        disabled={disabled}
        className={cn(
          "appearance-none w-full min-w-[160px] px-3 py-2 pr-8",
          "bg-muted/40 border-none rounded-lg",
          "text-sm text-foreground",
          "focus:outline-none focus:bg-muted/60 focus:ring-1 focus:ring-ring/30",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "cursor-pointer transition-colors"
        )}
      >
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
      <CaretDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
    </div>
  );
}
