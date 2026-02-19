/**
 * UnsavedChangesDialog - Modal dialog for unsaved changes warning
 * Shows when closing a tab with dirty state
 * Built on the AlertDialog primitive
 */

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
} from '../ui/alert-dialog';

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
  return (
    <AlertDialog open={isOpen} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <AlertDialogContent className="w-96 p-4 gap-0">
        <AlertDialogHeader className="mb-3">
          <AlertDialogTitle className="flex items-center gap-2 text-sm font-medium">
            <Warning className="w-4 h-4 text-warning" />
            Unsaved Changes
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              <p className="text-sm text-muted-foreground mb-1">
                Do you want to save changes to &ldquo;{title}&rdquo; before closing?
              </p>
              <p className="text-xs text-muted-foreground/70">
                Your changes will be lost if you don&apos;t save them.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onDontSave}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:brightness-100"
          >
            Don&apos;t Save
          </AlertDialogAction>
          {onSave && (
            <AlertDialogAction onClick={onSave}>
              Save
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
