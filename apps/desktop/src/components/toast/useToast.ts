/**
 * useToast - Toast notification state management
 */

import { create } from 'zustand';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  message: string;
  description?: string;
  variant: ToastVariant;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastState {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => string;
  removeToast: (id: string) => void;
  clearAll: () => void;
}

let toastId = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (toast) => {
    const id = `toast-${++toastId}`;
    set((state) => ({
      toasts: [...state.toasts.slice(-2), { ...toast, id }], // Keep max 3 toasts
    }));
    return id;
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },

  clearAll: () => {
    set({ toasts: [] });
  },
}));

/**
 * Hook for toast notifications
 */
export function useToast() {
  const { addToast, removeToast, clearAll } = useToastStore();

  return {
    toast: (message: string, options?: Partial<Omit<Toast, 'id' | 'message'>>) => {
      return addToast({
        message,
        variant: options?.variant ?? 'info',
        ...options,
      });
    },
    success: (message: string, description?: string) => {
      return addToast({ message, description, variant: 'success' });
    },
    error: (message: string, description?: string) => {
      return addToast({ message, description, variant: 'error' });
    },
    warning: (message: string, description?: string) => {
      return addToast({ message, description, variant: 'warning' });
    },
    info: (message: string, description?: string) => {
      return addToast({ message, description, variant: 'info' });
    },
    dismiss: removeToast,
    clearAll,
  };
}
