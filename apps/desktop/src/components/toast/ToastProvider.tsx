/**
 * ToastProvider - Container for toast notifications
 * Positioned in bottom-right corner
 */

import { createPortal } from 'react-dom';
import { Toast } from './Toast';
import { useToastStore } from './useToast';
import { cn } from '@/lib/utils';

export function ToastProvider() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) {
    return null;
  }

  return createPortal(
    <div
      className={cn(
        'fixed bottom-4 right-4 z-50',
        'flex flex-col-reverse gap-2',
        'pointer-events-none'
      )}
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <Toast toast={toast} onDismiss={removeToast} />
        </div>
      ))}
    </div>,
    document.body
  );
}
