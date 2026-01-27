/**
 * Panel Registry
 * Extensible system for registering and retrieving panel types
 */

import { useSyncExternalStore } from 'react';
import type { PanelTypeRegistration } from './types';

class PanelRegistry {
  private registrations = new Map<string, PanelTypeRegistration>();
  private listeners = new Set<() => void>();

  /**
   * Register a panel type
   */
  register<TData = Record<string, unknown>>(
    registration: PanelTypeRegistration<TData>
  ): void {
    if (this.registrations.has(registration.id)) {
      console.warn(`Panel type "${registration.id}" is already registered. Overwriting.`);
    }
    this.registrations.set(registration.id, registration as PanelTypeRegistration);
    this.notifyListeners();
  }

  /**
   * Unregister a panel type
   */
  unregister(id: string): boolean {
    const result = this.registrations.delete(id);
    if (result) this.notifyListeners();
    return result;
  }

  /**
   * Get a panel type registration
   */
  get(id: string): PanelTypeRegistration | undefined {
    return this.registrations.get(id);
  }

  /**
   * Get all registered panel types
   */
  getAll(): PanelTypeRegistration[] {
    return Array.from(this.registrations.values());
  }

  /**
   * Check if a panel type is registered
   */
  has(id: string): boolean {
    return this.registrations.has(id);
  }

  /**
   * Subscribe to registry changes
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get snapshot for useSyncExternalStore
   */
  getSnapshot = (): PanelTypeRegistration[] => {
    return this.getAll();
  };

  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener());
  }
}

// Singleton instance
export const panelRegistry = new PanelRegistry();

/**
 * React hook for accessing all registered panel types
 * Re-renders when the registry changes
 */
export function usePanelRegistry(): PanelTypeRegistration[] {
  return useSyncExternalStore(
    panelRegistry.subscribe.bind(panelRegistry),
    panelRegistry.getSnapshot,
    panelRegistry.getSnapshot
  );
}

/**
 * React hook for accessing a specific panel type
 */
export function usePanelType(id: string): PanelTypeRegistration | undefined {
  const types = usePanelRegistry();
  return types.find((t) => t.id === id);
}
