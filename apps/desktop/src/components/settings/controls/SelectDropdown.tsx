/**
 * SelectDropdown - Enum selection control
 */

import { ChevronDown } from 'lucide-react';

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
    <div className={`relative ${className}`}>
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
        className={`
          appearance-none w-full min-w-[140px] px-3 py-1.5 pr-8
          bg-background border border-border rounded-md
          text-sm text-foreground
          focus:outline-none focus:ring-2 focus:ring-primary/50
          disabled:cursor-not-allowed disabled:opacity-50
        `}
      >
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
    </div>
  );
}
