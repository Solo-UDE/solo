import { create } from 'zustand';
import { readDirectory } from '@/lib/tauri/fs';
import { fuzzySearchFiles, type FileEntry, type FileSearchResult } from '@/lib/fuzzySearch';
import type { FileTreeEntry } from '@/bindings';

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'build',
  'target',
  '.cache',
  '.vite',
  '__pycache__',
  '.DS_Store',
]);

const IGNORED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp3', '.mp4', '.wav', '.avi', '.mov',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.exe', '.dll', '.so', '.dylib',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
]);

const MAX_FILE_COUNT = 10_000;
const MAX_ROOTS = 3;

export interface WorkspaceFileIndex {
  files: FileEntry[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  updatedAt: number | null;
}

interface WorkspaceFileIndexState {
  indexes: Map<string, WorkspaceFileIndex>;
  ensureIndex: (rootPath: string) => Promise<FileEntry[]>;
  search: (rootPath: string, query: string, limit?: number) => FileSearchResult[];
  refresh: (rootPath: string) => Promise<FileEntry[]>;
  clear: (rootPath: string) => void;
}

const EMPTY_INDEX: WorkspaceFileIndex = Object.freeze({
  files: [],
  loading: false,
  loaded: false,
  error: null,
  updatedAt: null,
});

const inFlight = new Map<string, Promise<FileEntry[]>>();
let scanSeq = 0;

function getExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

function shouldSkipDir(name: string): boolean {
  return IGNORED_DIRS.has(name);
}

function shouldSkipFile(name: string): boolean {
  return IGNORED_EXTENSIONS.has(getExtension(name));
}

function touchRoot(indexes: Map<string, WorkspaceFileIndex>, rootPath: string): Map<string, WorkspaceFileIndex> {
  const existing = indexes.get(rootPath);
  if (!existing) return indexes;
  const next = new Map(indexes);
  next.delete(rootPath);
  next.set(rootPath, existing);
  while (next.size > MAX_ROOTS) {
    const oldest = next.keys().next().value as string | undefined;
    if (!oldest) break;
    next.delete(oldest);
    inFlight.delete(oldest);
  }
  return next;
}

async function scanWorkspace(rootPath: string, seq: number): Promise<FileEntry[]> {
  const result: FileEntry[] = [];
  const queue: string[] = [rootPath];

  while (queue.length > 0 && result.length < MAX_FILE_COUNT) {
    if (seq !== scanSeq) return result;
    const dirPath = queue.shift();
    if (!dirPath) break;

    try {
      const response = await readDirectory(dirPath, 1);
      const entries: FileTreeEntry[] = response.entry.children ?? [];

      for (const entry of entries) {
        if (seq !== scanSeq) return result;
        if (entry.is_dir) {
          if (!shouldSkipDir(entry.name)) queue.push(entry.path);
          continue;
        }
        if (shouldSkipFile(entry.name)) continue;
        const relativePath = entry.path.startsWith(rootPath)
          ? entry.path.slice(rootPath.length + 1)
          : entry.path;
        result.push({
          path: entry.path,
          name: entry.name,
          relativePath,
        });
        if (result.length >= MAX_FILE_COUNT) break;
      }
    } catch {
      // Unreadable directories are skipped so the mention index remains usable.
    }
  }

  return result;
}

function setIndex(rootPath: string, patch: Partial<WorkspaceFileIndex>): void {
  useWorkspaceFileIndexStore.setState((state) => {
    const current = state.indexes.get(rootPath) ?? EMPTY_INDEX;
    const indexes = touchRoot(state.indexes, rootPath);
    indexes.set(rootPath, {
      ...current,
      ...patch,
    });
    while (indexes.size > MAX_ROOTS) {
      const oldest = indexes.keys().next().value as string | undefined;
      if (!oldest) break;
      indexes.delete(oldest);
      inFlight.delete(oldest);
    }
    return { indexes };
  });
}

export const useWorkspaceFileIndexStore = create<WorkspaceFileIndexState>()((set, get) => ({
  indexes: new Map(),

  ensureIndex: async (rootPath: string) => {
    const existing = get().indexes.get(rootPath);
    if (existing?.loaded) {
      set((state) => ({ indexes: touchRoot(state.indexes, rootPath) }));
      return existing.files;
    }

    const pending = inFlight.get(rootPath);
    if (pending) return pending;

    const seq = ++scanSeq;
    setIndex(rootPath, { loading: true, error: null });

    const promise = scanWorkspace(rootPath, seq)
      .then((files) => {
        setIndex(rootPath, {
          files,
          loading: false,
          loaded: true,
          error: null,
          updatedAt: Date.now(),
        });
        return files;
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setIndex(rootPath, { loading: false, error: message });
        throw error;
      })
      .finally(() => {
        if (inFlight.get(rootPath) === promise) inFlight.delete(rootPath);
      });

    inFlight.set(rootPath, promise);
    return promise;
  },

  search: (rootPath: string, query: string, limit = 20) => {
    const files = get().indexes.get(rootPath)?.files ?? [];
    return fuzzySearchFiles(query, files, limit);
  },

  refresh: async (rootPath: string) => {
    scanSeq += 1;
    inFlight.delete(rootPath);
    set((state) => {
      const indexes = new Map(state.indexes);
      const current = indexes.get(rootPath) ?? EMPTY_INDEX;
      indexes.set(rootPath, { ...current, loaded: false });
      return { indexes };
    });
    return get().ensureIndex(rootPath);
  },

  clear: (rootPath: string) => {
    scanSeq += 1;
    inFlight.delete(rootPath);
    set((state) => {
      const indexes = new Map(state.indexes);
      indexes.delete(rootPath);
      return { indexes };
    });
  },
}));

export function useWorkspaceFileIndex(rootPath: string | null): WorkspaceFileIndex {
  return useWorkspaceFileIndexStore((state) => {
    if (!rootPath) return EMPTY_INDEX;
    return state.indexes.get(rootPath) ?? EMPTY_INDEX;
  });
}

export function ensureWorkspaceFileIndex(rootPath: string): Promise<FileEntry[]> {
  return useWorkspaceFileIndexStore.getState().ensureIndex(rootPath);
}

export function searchWorkspaceFileIndex(rootPath: string | null, query: string): FileSearchResult[] {
  if (!rootPath) return [];
  return useWorkspaceFileIndexStore.getState().search(rootPath, query);
}
