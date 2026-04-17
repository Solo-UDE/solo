/**
 * PasswordInput - Masked input for API keys with visibility toggle
 */

import { useState, useCallback } from 'react';
import { EyeOpenIcon, EyeNoneIcon, Cross2Icon } from '@radix-ui/react-icons';

interface PasswordInputProps {
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  placeholder?: string;
  disabled?: boolean;
}

export function PasswordInput({
  value,
  onChange,
  onClear,
  placeholder = 'Enter API key...',
  disabled = false,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  const handleToggleVisibility = useCallback(() => {
    setVisible((v) => !v);
  }, []);

  const handleClear = useCallback(() => {
    onChange('');
    onClear?.();
  }, [onChange, onClear]);

  return (
    <div className="relative flex items-center">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`
          w-full min-w-[200px] px-3 py-2 pr-16
          bg-background border border-border rounded-lg
          text-sm text-foreground font-mono
          focus:outline-none focus:ring-2 focus:ring-primary/50
          disabled:cursor-not-allowed disabled:opacity-50
          placeholder:text-muted-foreground
        `}
      />
      <div className="absolute right-1 flex items-center gap-0.5">
        <button
          type="button"
          onClick={handleToggleVisibility}
          disabled={disabled}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors disabled:opacity-50 cursor-pointer"
          title={visible ? 'Hide' : 'Show'}
        >
          {visible ? (
            <EyeNoneIcon className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <EyeOpenIcon className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </button>
        {value && (
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors disabled:opacity-50 cursor-pointer"
            title="Clear"
          >
            <Cross2Icon className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        )}
      </div>
    </div>
  );
}
