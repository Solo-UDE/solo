/**
 * SettingsModal - Modal dialog for user preferences
 */

import { useCallback, useEffect, useRef } from 'react';
import { Settings, X } from 'lucide-react';
import { useSettingsStore, AUTOSAVE_OPTIONS, AutosaveDelay } from '../../stores/settingsStore';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const selectRef = useRef<HTMLSelectElement>(null);
  const autosaveDelay = useSettingsStore((s) => s.autosaveDelay);
  const setAutosaveDelay = useSettingsStore((s) => s.setAutosaveDelay);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        selectRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [onClose]
  );

  const handleDelayChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      const delay: AutosaveDelay = value === 'disabled' ? 'disabled' : (Number(value) as 0 | 5000 | 10000 | 30000);
      setAutosaveDelay(delay);
    },
    [setAutosaveDelay]
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="bg-card border border-border rounded-lg shadow-xl w-96 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Settings className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-medium text-foreground">Settings</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="autosave-delay" className="block text-sm font-medium text-foreground mb-2">
              Autosave Delay
            </label>
            <select
              ref={selectRef}
              id="autosave-delay"
              value={String(autosaveDelay)}
              onChange={handleDelayChange}
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {AUTOSAVE_OPTIONS.map((option) => (
                <option key={String(option.value)} value={String(option.value)}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs text-muted-foreground">
              Files are saved when you switch tabs or switch away from the app.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
