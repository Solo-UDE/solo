/**
 * ConfirmDialog - Unified confirmation dialog using AlertDialog primitive
 * Replaces file-explorer/ConfirmDialog and source-control/ConfirmDialog
 */

import { useEffect, useRef } from 'react';
import { Warning } from '@phosphor-icons/react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from './alert-dialog';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => confirmRef.current?.focus(), 50);
    }
  }, [isOpen]);

  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <AlertDialogContent className="w-80 p-4 gap-0">
        <AlertDialogHeader className="mb-3">
          <AlertDialogTitle className="flex items-center gap-2 text-sm font-medium">
            {variant === 'destructive' && (
              <Warning className="w-4 h-4 text-destructive" />
            )}
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm">
            {message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            ref={confirmRef}
            onClick={onConfirm}
            className={
              variant === 'destructive'
                ? 'bg-destructive/10 text-destructive hover:bg-destructive/20 hover:brightness-100'
                : undefined
            }
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
