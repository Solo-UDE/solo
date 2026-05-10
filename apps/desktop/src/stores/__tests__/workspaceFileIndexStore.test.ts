import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { FileTreeEntry } from '@/bindings';

const mockReadDirectory = mock(async (path: string) => ({
  entry: dir(path, []),
  total_count: null,
}));

mock.module('@/lib/tauri/fs', () => ({
  readDirectory: mockReadDirectory,
}));

const {
  ensureWorkspaceFileIndex,
  searchWorkspaceFileIndex,
  useWorkspaceFileIndexStore,
} = await import('@/stores/workspaceFileIndexStore');

function file(path: string): FileTreeEntry {
  return {
    name: path.split('/').pop() ?? path,
    path,
    is_dir: false,
    children: null,
    size: 1n,
    modified: 1n,
  };
}

function dir(path: string, children: FileTreeEntry[] | null = null): FileTreeEntry {
  return {
    name: path.split('/').pop() ?? path,
    path,
    is_dir: true,
    children,
    size: null,
    modified: 1n,
  };
}

function resetStore(): void {
  useWorkspaceFileIndexStore.setState({
    indexes: new Map(),
  });
}

describe('workspaceFileIndexStore', () => {
  beforeEach(() => {
    resetStore();
    mockReadDirectory.mockReset();
  });

  it('shares one scan across concurrent mention index requests', async () => {
    mockReadDirectory.mockImplementation(async (path: string) => {
      if (path === '/repo') {
        return {
          entry: dir('/repo', [file('/repo/App.tsx'), dir('/repo/src')]),
          total_count: null,
        };
      }
      if (path === '/repo/src') {
        return {
          entry: dir('/repo/src', [file('/repo/src/main.ts')]),
          total_count: null,
        };
      }
      return { entry: dir(path, []), total_count: null };
    });

    const [first, second] = await Promise.all([
      ensureWorkspaceFileIndex('/repo'),
      ensureWorkspaceFileIndex('/repo'),
    ]);

    expect(first.map((entry) => entry.relativePath).sort()).toEqual([
      'App.tsx',
      'src/main.ts',
    ]);
    expect(second).toEqual(first);
    expect(mockReadDirectory).toHaveBeenCalledTimes(2);

    await ensureWorkspaceFileIndex('/repo');
    expect(mockReadDirectory).toHaveBeenCalledTimes(2);
  });

  it('searches cached files without starting a new scan', async () => {
    mockReadDirectory.mockImplementation(async (path: string) => ({
      entry: dir(path, [file('/repo/components/Button.tsx')]),
      total_count: null,
    }));

    await ensureWorkspaceFileIndex('/repo');
    mockReadDirectory.mockClear();

    const results = searchWorkspaceFileIndex('/repo', 'button');
    expect(results[0]?.relativePath).toBe('components/Button.tsx');
    expect(mockReadDirectory).not.toHaveBeenCalled();
  });

  it('does not publish a stale scan after clear', async () => {
    let resolveRead!: (value: { entry: FileTreeEntry; total_count: null }) => void;
    mockReadDirectory.mockImplementation(
      () =>
        new Promise<{ entry: FileTreeEntry; total_count: null }>((resolve) => {
          resolveRead = resolve;
        }),
    );

    const pending = ensureWorkspaceFileIndex('/repo');
    useWorkspaceFileIndexStore.getState().clear('/repo');
    resolveRead({
      entry: dir('/repo', [file('/repo/stale.ts')]),
      total_count: null,
    });
    await pending;

    expect(useWorkspaceFileIndexStore.getState().indexes.has('/repo')).toBe(false);
  });
});
