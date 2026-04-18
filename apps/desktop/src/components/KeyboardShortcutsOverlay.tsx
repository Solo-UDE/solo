import { useState, useMemo } from 'react';
import { MagnifyingGlassIcon, GearIcon } from '@radix-ui/react-icons';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from './ui/dialog';
import {
  KEYBINDING_CATEGORIES,
  buildEffectiveKeybindings,
  formatKeybinding,
} from '@/lib/keybindings/registry';
import { useSettingsStore } from '@/stores/settingsStore';

interface KeyboardShortcutsOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSettings: () => void;
}

export const KeyboardShortcutsOverlay = ({
  open,
  onOpenChange,
  onOpenSettings,
}: KeyboardShortcutsOverlayProps) => {
  const [search, setSearch] = useState('');
  const customKeybindings = useSettingsStore((s) => s.shortcuts.keybindings);

  // Build effective keybindings (custom overrides merged with defaults)
  const effectiveKeybindings = useMemo(
    () => buildEffectiveKeybindings(customKeybindings),
    [customKeybindings]
  );

  // Filter categories based on search
  const filteredCategories = useMemo(() => {
    const query = search.toLowerCase().trim();
    if (!query) return KEYBINDING_CATEGORIES;

    return KEYBINDING_CATEGORIES
      .map((cat) => ({
        ...cat,
        bindings: cat.bindings.filter(
          (b) =>
            b.label.toLowerCase().includes(query) ||
            b.description?.toLowerCase().includes(query) ||
            formatKeybinding(effectiveKeybindings[b.id] ?? b.defaultKey)
              .toLowerCase()
              .includes(query)
        ),
      }))
      .filter((cat) => cat.bindings.length > 0);
  }, [search, effectiveKeybindings]);

  // Reset search when dialog closes
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setSearch('');
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-2xl w-[calc(100%-2rem)] bg-card/95 backdrop-blur-md rounded-[14px] shadow-[0_8px_32px_-8px_rgba(0,0,0,0.3)] p-0 gap-0 border-0"
        showCloseButton={false}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-3">
          <DialogTitle className="text-base font-semibold flex-1">
            Keyboard Shortcuts
          </DialogTitle>
          <div className="relative flex-1 max-w-[220px]">
            <MagnifyingGlassIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
            <input
              type="text"
              placeholder="Search shortcuts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-8 pl-8 pr-3 rounded-lg bg-muted/40 text-sm placeholder:text-muted-foreground/50 focus:bg-muted/60 focus:ring-1 focus:ring-ring/30 focus:outline-none transition-colors duration-150"
              autoFocus
            />
          </div>
        </div>

        {/* Shortcuts grid */}
        <div className="px-5 pb-2 max-h-[60vh] overflow-y-auto overflow-x-hidden">
          {filteredCategories.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground/60">
              No shortcuts found for "{search}"
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
              {filteredCategories.map((category) => (
                <div key={category.id} className="mb-3">
                  <div className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-1.5 px-1">
                    {category.label}
                  </div>
                  <div className="space-y-0.5">
                    {category.bindings.map((binding) => {
                      const key = effectiveKeybindings[binding.id] ?? binding.defaultKey;
                      const isImplemented = binding.implemented !== false;
                      return (
                        <div
                          key={binding.id}
                          className={`flex items-center justify-between py-1.5 px-1 rounded-md group ${
                            isImplemented ? '' : 'opacity-40'
                          }`}
                          title={isImplemented ? undefined : 'Coming soon'}
                        >
                          <span className="text-sm text-foreground/90 truncate pr-3">
                            {binding.label}
                          </span>
                          <kbd className="shrink-0 text-xs font-mono text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-md min-w-[2rem] text-center">
                            {formatKeybinding(key)}
                          </kbd>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border/30">
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors duration-150 group"
          >
            <GearIcon className="w-3.5 h-3.5 group-hover:rotate-45 transition-transform duration-200" />
            <span>Customize in Settings</span>
            <span className="text-muted-foreground/40 group-hover:translate-x-0.5 transition-transform duration-150">
              →
            </span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
