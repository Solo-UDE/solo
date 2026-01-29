/**
 * Toast - Individual toast notification with glass morphism
 */

import { useEffect, useCallback, useState } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Toast as ToastType, ToastVariant } from './useToast';

interface ToastProps {
  toast: ToastType;
  onDismiss: (id: string) => void;
}

const icons: Record<ToastVariant, typeof Info> = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: AlertCircle,
};

const variantStyles: Record<ToastVariant, string> = {
  info: 'border-l-primary text-primary',
  success: 'border-l-status-success text-status-success',
  warning: 'border-l-status-warning text-status-warning',
  error: 'border-l-status-error text-status-error',
};

export function Toast({ toast, onDismiss }: ToastProps) {
  const [isExiting, setIsExiting] = useState(false);
  const [progress, setProgress] = useState(100);
  const duration = toast.duration ?? 5000;

  const Icon = icons[toast.variant];

  const handleDismiss = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => onDismiss(toast.id), 200);
  }, [onDismiss, toast.id]);

  // Auto-dismiss timer
  useEffect(() => {
    if (duration <= 0) return;

    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);

      if (remaining <= 0) {
        handleDismiss();
      }
    }, 50);

    return () => clearInterval(interval);
  }, [duration, handleDismiss]);

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        'relative flex items-start gap-3 w-80 p-4',
        'bg-bg-glass backdrop-blur-xl',
        'rounded-lg border border-border-subtle border-l-4',
        'shadow-[0_8px_32px_-8px_rgba(0,0,0,0.4)]',
        variantStyles[toast.variant],
        isExiting ? 'animate-slide-out-right' : 'animate-slide-in-right'
      )}
    >
      {/* Icon */}
      <Icon className="w-5 h-5 shrink-0 mt-0.5" />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{toast.message}</p>
        {toast.description && (
          <p className="mt-1 text-xs text-muted-foreground">{toast.description}</p>
        )}
        {toast.action && (
          <button
            onClick={toast.action.onClick}
            className="mt-2 text-xs font-medium text-primary hover:underline"
          >
            {toast.action.label}
          </button>
        )}
      </div>

      {/* Dismiss button */}
      <button
        onClick={handleDismiss}
        className={cn(
          'shrink-0 p-1 rounded',
          'text-muted-foreground hover:text-foreground',
          'hover:bg-bg-surface-2',
          'transition-colors duration-100'
        )}
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>

      {/* Progress bar */}
      {duration > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-border-subtle overflow-hidden rounded-b-lg">
          <div
            className={cn(
              'h-full transition-all duration-100',
              toast.variant === 'success' && 'bg-status-success',
              toast.variant === 'error' && 'bg-status-error',
              toast.variant === 'warning' && 'bg-status-warning',
              toast.variant === 'info' && 'bg-primary'
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}
