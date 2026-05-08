import { Stepper } from '../../ui/stepper';

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
  return (
    <Stepper
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
