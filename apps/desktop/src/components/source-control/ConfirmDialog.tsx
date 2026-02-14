/**
 * ConfirmDialog — modal for confirming destructive git operations
 */

import { useCallback, useEffect } from 'react';
import type { FC } from 'react';
import { cn } from '@/lib/utils';

interface ConfirmDialogProps {
  readonly isOpen: boolean;
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export const ConfirmDialog: FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  onConfirm,
  onCancel,
}) => {
  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onCancel();
    },
    [onCancel],
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        className={cn(
          'bg-card/95 backdrop-blur-md rounded-[14px] p-5 w-[340px]',
          'shadow-[0_8px_32px_-8px_rgba(0,0,0,0.3)]',
          'animate-in fade-in zoom-in-95 duration-200',
        )}
      >
        <h3 className="text-sm font-semibold text-foreground mb-2">{title}</h3>
        <p className="text-xs text-muted-foreground mb-4 leading-relaxed">{message}</p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className={cn(
              'h-[34px] px-3.5 rounded-[10px] text-xs font-medium',
              'bg-muted/40 text-foreground',
              'hover:bg-muted/60 active:scale-[0.97] transition-all duration-200',
            )}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              'h-[34px] px-3.5 rounded-[10px] text-xs font-medium',
              'bg-destructive/10 text-destructive',
              'hover:bg-destructive/20 active:scale-[0.97] transition-all duration-200',
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
