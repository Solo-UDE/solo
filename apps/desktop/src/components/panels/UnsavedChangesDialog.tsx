/**
 * UnsavedChangesDialog - Modal dialog for unsaved changes warning
 * Shows when closing a tab with dirty state
 */

import { useCallback, useEffect, useRef } from 'react';
import { Warning } from '@phosphor-icons/react';

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onCancel}
      onKeyDown={handleKeyDown}
    >
      <div
        className="bg-popover rounded-[14px] shadow-[0_8px_32px_-8px_rgba(0,0,0,0.3)] w-96 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <Warning className="w-4 h-4 text-yellow-500" />
          <h3 className="text-sm font-medium text-foreground">Unsaved Changes</h3>
        </div>

        <p className="text-sm text-muted-foreground mb-1">
          Do you want to save changes to "{title}" before closing?
        </p>
        <p className="text-xs text-muted-foreground/70 mb-4">
          Your changes will be lost if you don't save them.
        </p>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-[34px] px-3 text-sm rounded-[10px] bg-muted/40 text-foreground hover:bg-muted/60 active:scale-[0.97] transition-all duration-200"
          >
            Cancel
          </button>
          <button
            ref={dontSaveButtonRef}
            type="button"
            onClick={onDontSave}
            className="h-[34px] px-3.5 text-sm rounded-[10px] bg-destructive text-destructive-foreground hover:bg-destructive/90 active:scale-[0.97] transition-all duration-200"
          >
            Don't Save
          </button>
          {onSave && (
            <button
              type="button"
              onClick={onSave}
              className="h-[34px] px-3.5 text-sm rounded-[10px] bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.97] transition-all duration-200"
            >
              Save
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
