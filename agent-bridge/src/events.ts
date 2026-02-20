/**
 * Simple event emitter and disposable pattern for agent-bridge
 * Replaces VS Code's lifecycle and event utilities
 */

/**
 * Interface for disposable resources
 */
export interface IDisposable {
  dispose(): void;
}

/**
 * Base class for disposable objects
 */
export class Disposable implements IDisposable {
  private _isDisposed = false;
  private _disposables: IDisposable[] = [];

  protected get isDisposed(): boolean {
    return this._isDisposed;
  }

  /**
   * Register a disposable to be cleaned up when this object is disposed
   */
  protected _register<T extends IDisposable>(disposable: T): T {
    this._disposables.push(disposable);
    return disposable;
  }

  /**
   * Dispose all registered disposables
   */
  dispose(): void {
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }
}

/**
 * Event listener type
 */
export type Listener<T> = (event: T) => void;

/**
 * Event type (subscribe function)
 */
export type Event<T> = (listener: Listener<T>) => IDisposable;

/**
 * Simple event emitter
 */
export class Emitter<T> implements IDisposable {
  private _listeners = new Set<Listener<T>>();
  private _disposed = false;

  /**
   * The event that can be subscribed to
   */
  readonly event: Event<T> = (listener: Listener<T>): IDisposable => {
    if (this._disposed) {
      // Return a no-op disposable for already disposed emitters
      return {
        dispose: (): void => {
          /* already disposed */
        },
      };
    }
    this._listeners.add(listener);
    return {
      dispose: () => {
        this._listeners.delete(listener);
      },
    };
  };

  /**
   * Fire the event with a value
   */
  fire(event: T): void {
    if (this._disposed) {
      return;
    }
    for (const listener of this._listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[Emitter] Error in event listener:', error);
      }
    }
  }

  /**
   * Dispose the emitter and clear all listeners
   */
  dispose(): void {
    this._disposed = true;
    this._listeners.clear();
  }
}
