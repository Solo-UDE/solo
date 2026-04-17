/**
 * ShortcutsTab - Keyboard shortcuts configuration
 */

import { useState, useMemo, useCallback } from 'react';
import { MagnifyingGlassIcon, CounterClockwiseClockIcon } from '@radix-ui/react-icons';
import { useSettingsStore } from '../../../stores/settingsStore';
import { KeybindingInput } from '../controls';
import {
  KEYBINDING_CATEGORIES,
  DEFAULT_KEYBINDINGS,
  buildEffectiveKeybindings,
  getKeybindingConflicts,
  type KeybindingDefinition,
} from '../../../lib/keybindings/registry';

export function ShortcutsTab() {
  const [searchQuery, setSearchQuery] = useState('');
  const customKeybindings = useSettingsStore((s) => s.shortcuts.keybindings);
  const setKeybinding = useSettingsStore((s) => s.setKeybinding);
  const resetKeybinding = useSettingsStore((s) => s.resetKeybinding);
  const resetAllKeybindings = useSettingsStore((s) => s.resetAllKeybindings);

  // Build effective keybindings (custom + defaults)
  const effectiveKeybindings = useMemo(
    () => buildEffectiveKeybindings(customKeybindings),
    [customKeybindings]
  );

  // Find conflicts
  const conflicts = useMemo(
    () => getKeybindingConflicts(effectiveKeybindings),
    [effectiveKeybindings]
  );

  // Filter by search query
  const filteredCategories = useMemo(() => {
    const query = searchQuery.toLowerCase();
    if (!query) return KEYBINDING_CATEGORIES;

    return KEYBINDING_CATEGORIES.map((category) => ({
      ...category,
      bindings: category.bindings.filter(
        (binding) =>
          binding.label.toLowerCase().includes(query) ||
          binding.description?.toLowerCase().includes(query) ||
          effectiveKeybindings[binding.id]?.toLowerCase().includes(query)
      ),
    })).filter((category) => category.bindings.length > 0);
  }, [searchQuery, effectiveKeybindings]);

  const handleKeybindingChange = useCallback(
    (id: string, newKey: string) => {
      setKeybinding(id, newKey);
    },
    [setKeybinding]
  );

  const handleReset = useCallback(
    (id: string) => {
      resetKeybinding(id);
    },
    [resetKeybinding]
  );

  const hasCustomizations = Object.keys(customKeybindings).length > 0;

  return (
    <div className="space-y-6">
      {/* Search and Reset */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search shortcuts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        {hasCustomizations && (
          <button
            type="button"
            onClick={resetAllKeybindings}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
          >
            <CounterClockwiseClockIcon className="w-4 h-4" />
            Reset All
          </button>
        )}
      </div>

      {/* Keybinding Categories */}
      <div className="space-y-8">
        {filteredCategories.map((category) => (
          <div key={category.id}>
            <h3 className="text-xs font-semibold text-muted-foreground mb-4">
              {category.label}
            </h3>
            <div className="divide-y divide-border">
              {category.bindings.map((binding) => {
                const currentKey = effectiveKeybindings[binding.id] ?? '';
                const isModified = customKeybindings[binding.id] !== undefined;
                const conflictingIds = conflicts[binding.id] ?? [];
                const hasConflict = conflictingIds.length > 0;

                return (
                  <KeybindingRow
                    key={binding.id}
                    binding={binding}
                    currentKey={currentKey}
                    isModified={isModified}
                    hasConflict={hasConflict}
                    conflictingIds={conflictingIds}
                    onKeybindingChange={(newKey) => handleKeybindingChange(binding.id, newKey)}
                    onReset={() => handleReset(binding.id)}
                  />
                );
              })}
            </div>
          </div>
        ))}

        {filteredCategories.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-1.5">
            <MagnifyingGlassIcon className="w-5 h-5 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground/60">No shortcuts found</p>
            <p className="text-xs text-muted-foreground/40">Try a different search term</p>
          </div>
        )}
      </div>
    </div>
  );
}

interface KeybindingRowProps {
  binding: KeybindingDefinition;
  currentKey: string;
  isModified: boolean;
  hasConflict: boolean;
  conflictingIds: string[];
  onKeybindingChange: (newKey: string) => void;
  onReset: () => void;
}

function KeybindingRow({
  binding,
  currentKey,
  isModified,
  hasConflict,
  conflictingIds,
  onKeybindingChange,
  onReset,
}: KeybindingRowProps) {
  const conflictMessage = hasConflict
    ? `Conflicts with: ${conflictingIds.map((id) => {
        const def = DEFAULT_KEYBINDINGS.find((d) => d.id === id);
        return def?.label ?? id;
      }).join(', ')}`
    : undefined;

  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1 pr-4">
        <div className="text-sm font-medium text-foreground">
          {binding.label}
          {isModified && (
            <span className="ml-2 text-xs text-primary">(modified)</span>
          )}
        </div>
        {binding.description && (
          <div className="text-xs text-muted-foreground mt-0.5">
            {binding.description}
          </div>
        )}
      </div>
      <KeybindingInput
        value={currentKey}
        defaultValue={binding.defaultKey}
        onChange={onKeybindingChange}
        onReset={onReset}
        hasConflict={hasConflict}
        conflictMessage={conflictMessage}
      />
    </div>
  );
}
