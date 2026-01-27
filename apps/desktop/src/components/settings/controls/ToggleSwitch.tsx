/**
 * ToggleSwitch - Boolean toggle control
 */

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function ToggleSwitch({ checked, onChange, disabled = false }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`
        relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full
        border-2 border-transparent transition-colors duration-200 ease-in-out
        focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50
        disabled:cursor-not-allowed disabled:opacity-50
        ${checked ? 'bg-primary' : 'bg-muted'}
      `}
    >
      <span
        className={`
          pointer-events-none inline-block h-4 w-4 rounded-full
          bg-white shadow-sm ring-0 transition-transform duration-200 ease-in-out
          ${checked ? 'translate-x-4' : 'translate-x-0'}
        `}
      />
    </button>
  );
}
