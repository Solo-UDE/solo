/**
 * AgentMux — Event queue for streaming agent events to the desktop via WebSocket.
 *
 * Usage:
 *   const mux = new AgentMux();
 *   mux.subscribe((event) => ws.send(JSON.stringify(event)));
 *   await mux.put({ type: 'agent:chunk', conversation_id: '...', content: '...' });
 */

import { EventEmitter } from 'events';

export class AgentMux {
  private emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(0);
  }

  /** Emit an event to all subscribers */
  async put(event: any): Promise<void> {
    this.emitter.emit('event', event);
  }

  /** Subscribe to all events. Returns an unsubscribe function. */
  subscribe(handler: (event: any) => void | Promise<void>): () => void {
    this.emitter.on('event', handler);
    return () => this.emitter.off('event', handler);
  }

  /** Check if no listeners are attached */
  empty(): boolean {
    return this.emitter.listenerCount('event') === 0;
  }

  /** Remove all listeners */
  clear(): void {
    this.emitter.removeAllListeners();
  }

  /** Get current subscriber count */
  listenerCount(): number {
    return this.emitter.listenerCount('event');
  }
}
