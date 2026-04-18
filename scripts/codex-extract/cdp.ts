// Thin Chrome DevTools Protocol client using Bun's WebSocket global.
// We only implement what extractors need: send with request/response correlation,
// subscribe to events, clean shutdown.

import type { CdpClient, CdpMessage, Logger } from './types';

interface Pending {
  resolve: (v: unknown) => void;
  reject: (err: Error) => void;
  method: string;
}

export function connectCdp(wsUrl: string, logger: Logger): Promise<CdpClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map<number, Pending>();
    const listeners = new Map<string, Set<(params: unknown) => void>>();
    let nextId = 1;
    let closed = false;

    const openTimer = setTimeout(() => {
      reject(new Error(`CDP connection timeout: ${wsUrl}`));
      ws.close();
    }, 10_000);

    ws.addEventListener('open', () => {
      clearTimeout(openTimer);
      logger.info(`CDP connected ${wsUrl}`);
      resolve(client);
    });

    ws.addEventListener('error', (ev) => {
      logger.error('CDP socket error', ev);
      if (!closed) {
        for (const { reject } of pending.values()) {
          reject(new Error('CDP socket error'));
        }
      }
    });

    ws.addEventListener('close', () => {
      closed = true;
      clearTimeout(openTimer);
      for (const { reject } of pending.values()) {
        reject(new Error('CDP socket closed'));
      }
      pending.clear();
    });

    ws.addEventListener('message', (ev) => {
      let msg: CdpMessage;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
      } catch (err) {
        logger.warn('CDP: unparseable message', err);
        return;
      }

      // Response to a prior request
      if (typeof msg.id === 'number') {
        const waiter = pending.get(msg.id);
        if (waiter) {
          pending.delete(msg.id);
          if (msg.error) {
            waiter.reject(
              new Error(`CDP ${waiter.method} failed: ${msg.error.message} (${msg.error.code})`),
            );
          } else {
            waiter.resolve(msg.result);
          }
        }
        return;
      }

      // Event
      if (msg.method && listeners.has(msg.method)) {
        for (const h of listeners.get(msg.method)!) {
          try { h(msg.params); } catch (err) { logger.warn(`CDP event handler threw on ${msg.method}`, err); }
        }
      }
    });

    const client: CdpClient = {
      send<T>(method: string, params?: Record<string, unknown>) {
        return new Promise<T>((res, rej) => {
          if (closed || ws.readyState !== WebSocket.OPEN) {
            rej(new Error(`CDP send ${method} on closed socket`));
            return;
          }
          const id = nextId++;
          pending.set(id, {
            resolve: (v) => res(v as T),
            reject: rej,
            method,
          });
          ws.send(JSON.stringify({ id, method, params }));
          // 30s timeout per request — extractors can bump this via retry logic
          setTimeout(() => {
            if (pending.has(id)) {
              pending.delete(id);
              rej(new Error(`CDP ${method} timed out`));
            }
          }, 30_000);
        });
      },

      on(method: string, handler: (params: unknown) => void) {
        if (!listeners.has(method)) listeners.set(method, new Set());
        listeners.get(method)!.add(handler);
        return () => listeners.get(method)?.delete(handler);
      },

      async close() {
        closed = true;
        ws.close();
      },
    };
  });
}
