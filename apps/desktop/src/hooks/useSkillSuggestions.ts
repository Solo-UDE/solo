/**
 * useSkillSuggestions — debounces the user's current composer text, asks the
 * Rust marketplace for keyword-scored suggestions, and publishes them to the
 * marketplaceStore. The SuggestionBanner component reads from the store.
 *
 * Runs once per composer instance that mounts it. Do NOT mount in multiple
 * places simultaneously — the debounce + store writes would race.
 */

import { useEffect } from 'react';
import { useMarketplaceStore } from '@/stores/marketplaceStore';
import { useSkillStore } from '@/stores/skillStore';
import { searchMarketplace } from '@/lib/tauri/marketplace';

const DEBOUNCE_MS = 350;
const MIN_QUERY = 8;

export function useSkillSuggestions(composerText: string): void {
  const setSuggestions = useMarketplaceStore((s) => s.setSuggestions);
  const clearSuggestions = useMarketplaceStore((s) => s.clearSuggestions);
  const installed = useSkillStore((s) => s.available);

  useEffect(() => {
    const trimmed = composerText.trim();
    if (trimmed.length < MIN_QUERY) {
      clearSuggestions();
      return;
    }

    let cancelled = false;
    const installedIds = installed.map((s) => s.name);
    const timer = setTimeout(async () => {
      try {
        const hits = await searchMarketplace(trimmed, installedIds);
        if (!cancelled) setSuggestions(hits);
      } catch {
        // Registry unavailable, empty catalog, etc. — non-fatal.
        if (!cancelled) clearSuggestions();
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [composerText, installed, setSuggestions, clearSuggestions]);
}
