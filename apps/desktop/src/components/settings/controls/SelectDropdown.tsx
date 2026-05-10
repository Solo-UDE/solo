/**
 * SelectDropdown - Enum selection control built on Radix Select primitives.
 */

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
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
  label?: string;
}

const normalizeOptionValue = (value: string | number) =>
  String(value).replace(/['"]/g, '').replace(/\s+/g, '').toLowerCase();

export function SelectDropdown<T extends string | number>({
  value,
  options,
  onChange,
  disabled = false,
  className = '',
  label,
}: SelectDropdownProps<T>) {
  const normalizedValue = String(value);
  const selectedOption = options.find((option) => (
    String(option.value) === normalizedValue ||
    normalizeOptionValue(option.value) === normalizeOptionValue(normalizedValue)
  ));
  const displayLabel = selectedOption?.label ?? normalizedValue;

  const handleChange = (raw: string) => {
    const option = options.find((o) => String(o.value) === raw);
    if (option) onChange(option.value);
  };

  return (
    <Select value={normalizedValue} onValueChange={handleChange} disabled={disabled}>
      <SelectTrigger
        aria-label={label}
        className={cn(
          'min-w-[160px] rounded-lg border border-border/70 bg-background/70 shadow-sm',
          'hover:bg-card focus:outline-1 focus:outline-primary/50',
          className,
        )}
      >
        <span className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground">
          {displayLabel}
        </span>
      </SelectTrigger>
      <SelectContent
        align="center"
        className="min-w-[var(--radix-select-trigger-width)] rounded-lg border bg-popover p-1 shadow-md"
      >
        <SelectGroup className="flex flex-col gap-0.5">
          {label ? (
            <SelectLabel className="px-1 pb-1 text-sm font-semibold normal-case tracking-normal text-popover-foreground">
              {label}
            </SelectLabel>
          ) : null}
          {options.map((option) => (
            <SelectItem
              key={String(option.value)}
              value={String(option.value)}
              className="group flex cursor-pointer items-center gap-3 rounded-lg p-1 text-sm font-medium transition-[background-color,color] data-[disabled]:opacity-40 [&>span:first-child]:text-muted-foreground [&>span:first-child]:transition-[color,transform] [&>span:first-child]:duration-200 [&>span:first-child]:group-hover:scale-110 [&>span:first-child]:group-hover:text-foreground"
            >
              <span className="flex-1 truncate">{option.label}</span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
