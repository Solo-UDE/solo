export interface SoloPerfEntry {
  id: number;
  name: string;
  detail?: string;
  startedAt: number;
  handlerMs?: number;
  nextPaintMs?: number;
  settledMs?: number;
}

interface SoloPerfGlobal {
  entries: SoloPerfEntry[];
  start: (name: string, detail?: string) => SoloPerfHandle;
  clear: () => void;
}

export interface SoloPerfHandle {
  endHandler: () => void;
  settle: () => void;
}

declare global {
  interface Window {
    __soloPerf?: SoloPerfGlobal;
  }
}

const MAX_ENTRIES = 120;
let nextId = 1;

function getPerfGlobal(): SoloPerfGlobal | null {
  if (typeof window === 'undefined' || typeof performance === 'undefined') {
    return null;
  }

  if (!window.__soloPerf) {
    window.__soloPerf = {
      entries: [],
      start,
      clear: () => {
        window.__soloPerf?.entries.splice(0);
      },
    };
  }

  return window.__soloPerf;
}

function pushEntry(entry: SoloPerfEntry): void {
  const perf = getPerfGlobal();
  if (!perf) return;
  perf.entries.push(entry);
  if (perf.entries.length > MAX_ENTRIES) {
    perf.entries.splice(0, perf.entries.length - MAX_ENTRIES);
  }
}

function logEntry(entry: SoloPerfEntry): void {
  if (!import.meta.env.DEV) return;
  const parts = [
    `${entry.name}${entry.detail ? `:${entry.detail}` : ''}`,
    entry.handlerMs !== undefined ? `handler ${entry.handlerMs.toFixed(1)}ms` : null,
    entry.nextPaintMs !== undefined ? `paint ${entry.nextPaintMs.toFixed(1)}ms` : null,
    entry.settledMs !== undefined ? `settled ${entry.settledMs.toFixed(1)}ms` : null,
  ].filter(Boolean);
  console.debug(`[solo-perf] ${parts.join(' | ')}`);
}

export function start(name: string, detail?: string): SoloPerfHandle {
  const startedAt = performance.now();
  const entry: SoloPerfEntry = {
    id: nextId++,
    name,
    detail,
    startedAt,
  };
  pushEntry(entry);

  let handlerEnded = false;
  let settled = false;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      entry.nextPaintMs = performance.now() - startedAt;
      logEntry(entry);
    });
  });

  return {
    endHandler: () => {
      if (handlerEnded) return;
      handlerEnded = true;
      entry.handlerMs = performance.now() - startedAt;
      logEntry(entry);
    },
    settle: () => {
      if (settled) return;
      settled = true;
      entry.settledMs = performance.now() - startedAt;
      logEntry(entry);
    },
  };
}

export function trace(name: string, detail?: string): SoloPerfHandle {
  return getPerfGlobal()?.start(name, detail) ?? start(name, detail);
}

export function traceSync<T>(name: string, detail: string | undefined, fn: () => T): T {
  const perf = trace(name, detail);
  try {
    return fn();
  } finally {
    perf.endHandler();
    perf.settle();
  }
}

