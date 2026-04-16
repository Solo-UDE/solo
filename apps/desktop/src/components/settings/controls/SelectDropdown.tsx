/**
 * SelectDropdown - Enum selection control built on Radix Select primitives.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select';
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
  const handleChange = (raw: string) => {
    const option = options.find((o) => String(o.value) === raw);
    if (option) onChange(option.value);
  };

  return (
    <Select value={String(value)} onValueChange={handleChange} disabled={disabled}>
      <SelectTrigger className={cn('min-w-[160px]', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={String(option.value)} value={String(option.value)}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
