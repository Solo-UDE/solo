import { describe, expect, it, beforeEach, mock } from 'bun:test';
import type { RegistryEntry } from '@/bindings/RegistryEntry';

// Mock the IPC layer before importing the store so Bun's module loader
// picks up the replaced module.
const mockFetchRegistry = mock(async () => ({
  version: 1,
  generated_at: '2026-04-18T00:00:00Z',
  skills: [] as RegistryEntry[],
}));
const mockSearchMarketplace = mock(async () => []);
const mockInstallSkill = mock(async () => undefined);
const mockUninstallSkill = mock(async () => undefined);

mock.module('@/lib/tauri/marketplace', () => ({
  fetchRegistry: mockFetchRegistry,
  searchMarketplace: mockSearchMarketplace,
  installSkill: mockInstallSkill,
  uninstallSkill: mockUninstallSkill,
  writeInstalledSkill: mock(async () => undefined),
  writeWorkspaceAgentsMd: mock(async () => undefined),
}));

const { useMarketplaceStore } = await import('@/stores/marketplaceStore');

function entry(id: string, overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    id,
    name: id,
    version: '1.0.0',
    description: `${id} description`,
    categories: [],
    author: 'tester',
    license: 'MIT',
    tarball_url: 'https://example.invalid/tarball',
    sha256: '0'.repeat(64),
    tags: [],
    updated_at: '2026-04-18',
    ...overrides,
  };
}

function resetStore(): void {
  useMarketplaceStore.setState({
    registry: null,
    loading: false,
    error: null,
    suggestions: [],
    dismissedIds: new Set<string>(),
  });
}

describe('marketplaceStore', () => {
  beforeEach(() => {
    resetStore();
    mockFetchRegistry.mockClear();
    mockInstallSkill.mockClear();
    mockUninstallSkill.mockClear();
  });

  it('refreshes the registry from IPC', async () => {
    await useMarketplaceStore.getState().refreshRegistry();
    expect(mockFetchRegistry).toHaveBeenCalledTimes(1);
    expect(useMarketplaceStore.getState().registry?.version).toBe(1);
    expect(useMarketplaceStore.getState().loading).toBe(false);
    expect(useMarketplaceStore.getState().error).toBeNull();
  });

  it('stores error without clobbering cached registry on later failure', async () => {
    mockFetchRegistry.mockImplementationOnce(async () => {
      throw new Error('offline');
    });
    await useMarketplaceStore.getState().refreshRegistry();
    expect(useMarketplaceStore.getState().error).toBe('offline');
    expect(useMarketplaceStore.getState().loading).toBe(false);
  });

  it('filters dismissed suggestions', () => {
    const { setSuggestions, dismissSuggestion } = useMarketplaceStore.getState();
    setSuggestions([{ entry: entry('ui'), score: 0.9, reason: '' }]);
    expect(useMarketplaceStore.getState().suggestions).toHaveLength(1);
    dismissSuggestion('ui');
    expect(useMarketplaceStore.getState().suggestions).toHaveLength(0);
    // Re-setting the same suggestion should stay filtered out.
    setSuggestions([{ entry: entry('ui'), score: 0.9, reason: '' }]);
    expect(useMarketplaceStore.getState().suggestions).toHaveLength(0);
  });

  it('removes the installed skill from suggestions after install', async () => {
    const { setSuggestions, install } = useMarketplaceStore.getState();
    setSuggestions([{ entry: entry('ui'), score: 0.9, reason: '' }]);
    await install(entry('ui'));
    expect(mockInstallSkill).toHaveBeenCalledTimes(1);
    expect(useMarketplaceStore.getState().suggestions).toHaveLength(0);
  });

  it('calls uninstall IPC', async () => {
    await useMarketplaceStore.getState().uninstall('ui');
    expect(mockUninstallSkill).toHaveBeenCalledTimes(1);
  });

  it('clearSuggestions empties the list but leaves dismissals intact', () => {
    const { setSuggestions, dismissSuggestion, clearSuggestions } = useMarketplaceStore.getState();
    setSuggestions([{ entry: entry('ui'), score: 0.9, reason: '' }]);
    dismissSuggestion('ui');
    clearSuggestions();
    expect(useMarketplaceStore.getState().suggestions).toHaveLength(0);
    expect(useMarketplaceStore.getState().dismissedIds.has('ui')).toBe(true);
  });
});
