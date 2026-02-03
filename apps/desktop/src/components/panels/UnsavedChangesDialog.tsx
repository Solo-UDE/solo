/**
 * UnsavedChangesDialog - Modal dialog for unsaved changes warning
 * Shows when closing a tab with dirty state
 */

import { useCallback, useEffect, useRef } from 'react';
import { Warning, X } from '@phosphor-icons/react';

interface UnsavedChangesDialogProps {
  isOpen: boolean;
  title: string;
  onSave?: () => void;
  onDontSave: () => void;
  onCancel: () => void;
}

export function UnsavedChangesDialog({
  isOpen,
  title,
  onSave,
  onDontSave,
  onCancel,
}: UnsavedChangesDialogProps) {
  const dontSaveButtonRef = useRef<HTMLButtonElement>(null);

  // Focus the "Don't Save" button when dialog opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        dontSaveButtonRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    },
    [onCancel]
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onCancel}
      onKeyDown={handleKeyDown}
    >
      <div
        className="bg-card border border-border rounded-lg shadow-xl w-96 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Warning className="w-4 h-4 text-yellow-500" />
            <h3 className="text-sm font-medium text-foreground">Unsaved Changes</h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          Do you want to save changes to "{title}" before closing?
        </p>
        <p className="text-xs text-muted-foreground/70 mb-4">
          Your changes will be lost if you don't save them.
        </p>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
          >
            Cancel
          </button>
          <button
            ref={dontSaveButtonRef}
            type="button"
            onClick={onDontSave}
            className="px-3 py-1.5 text-sm bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded transition-colors"
          >
            Don't Save
          </button>
          {onSave && (
            <button
              type="button"
              onClick={onSave}
              className="px-3 py-1.5 text-sm bg-primary text-primary-foreground hover:bg-primary/90 rounded transition-colors"
            >
              Save
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
