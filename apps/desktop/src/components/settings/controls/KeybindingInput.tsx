/**
 * KeybindingInput - Keyboard shortcut capture control
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Cross2Icon, CounterClockwiseClockIcon } from '@radix-ui/react-icons';
import { Keyboard } from 'lucide-react';
import { parseKeyboardEvent } from '../../../lib/keybindings';

interface KeybindingInputProps {
  value: string;
  defaultValue?: string;
  onChange: (value: string) => void;
  onReset?: () => void;
  hasConflict?: boolean;
  conflictMessage?: string;
}

export function KeybindingInput({
  value,
  defaultValue,
  onChange,
  onReset,
  hasConflict = false,
  conflictMessage,
}: KeybindingInputProps) {
  const [isRecording, setIsRecording] = useState(false);
  const inputRef = useRef<HTMLButtonElement>(null);

  const handleStartRecording = useCallback(() => {
    setIsRecording(true);
  }, []);

  const handleClear = useCallback(() => {
    onChange('');
    setIsRecording(false);
  }, [onChange]);

  const handleReset = useCallback(() => {
    if (defaultValue !== undefined) {
      onChange(defaultValue);
    }
    onReset?.();
    setIsRecording(false);
  }, [defaultValue, onChange, onReset]);

  useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Escape cancels recording
      if (e.key === 'Escape') {
        setIsRecording(false);
        return;
      }

      // Only accept if there's at least one modifier + a key
      const hasModifier = e.metaKey || e.ctrlKey || e.altKey;
      const isModifierOnly = ['Meta', 'Control', 'Alt', 'Shift'].includes(e.key);

      if (hasModifier && !isModifierOnly) {
        const formatted = parseKeyboardEvent(e);
        onChange(formatted);
        setIsRecording(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isRecording, onChange]);

  // Click outside to cancel
  useEffect(() => {
    if (!isRecording) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setIsRecording(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isRecording]);

  const isModified = defaultValue !== undefined && value !== defaultValue;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <button
          ref={inputRef}
          type="button"
          onClick={handleStartRecording}
          data-keybinding-recording={isRecording ? 'true' : undefined}
          className={`
            inline-flex items-center gap-2 px-3 py-2 min-w-[140px]
            border rounded-lg text-sm font-mono cursor-pointer
            transition-colors
            ${isRecording
              ? 'bg-primary/10 border-primary text-primary'
              : hasConflict
                ? 'bg-destructive/10 border-destructive text-destructive'
                : 'bg-background border-border text-foreground hover:bg-muted'
            }
          `}
        >
          <Keyboard className="w-3.5 h-3.5" size={14} />
          {isRecording ? (
            <span className="text-xs">Press keys...</span>
          ) : value ? (
            <span>{value}</span>
          ) : (
            <span className="text-muted-foreground">Not set</span>
          )}
        </button>

        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors cursor-pointer"
            title="Clear"
          >
            <Cross2Icon className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        )}

        {isModified && (
          <button
            type="button"
            onClick={handleReset}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors cursor-pointer"
            title="Reset to default"
          >
            <CounterClockwiseClockIcon className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        )}
      </div>

      {hasConflict && conflictMessage && (
        <span className="text-xs text-destructive">{conflictMessage}</span>
      )}
    </div>
  );
}
