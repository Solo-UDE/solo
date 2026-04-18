/**
 * VaultSidebar — launcher for Vault panels.
 *
 * Six entries: Skills, Memory, Tasks, Current Vault, Plugins, Connectors.
 * Clicking an entry opens or focuses the corresponding panel in the main
 * editor area (`openPanel` with `allowMultiple: false` gives find-or-focus
 * behavior). The sidebar itself holds no content body — each section is
 * first-class main content now.
 */

import type { FC } from 'react';
import { useEffect } from 'react';
import { motion } from 'motion/react';
import {
  Sparkles,
  Brain,
  ListChecks,
  Vault as VaultIcon,
  Puzzle,
  PlugZap,
} from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { usePanelTabsStore } from '@/stores/panelTabsStore';
import type { VaultNav } from '@/stores/uiStore';
import { cn } from '@/lib/utils';

interface NavItem {
  key: VaultNav;
  label: string;
  icon: FC<{ className?: string }>;
  panelType: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'skills', label: 'Skills', icon: Sparkles, panelType: 'vault-skills' },
  { key: 'memory', label: 'Memory', icon: Brain, panelType: 'vault-memory' },
  { key: 'tasks', label: 'Tasks', icon: ListChecks, panelType: 'vault-tasks' },
  { key: 'current-vault', label: 'Current Vault', icon: VaultIcon, panelType: 'vault-current' },
  { key: 'plugins', label: 'Plugins', icon: Puzzle, panelType: 'vault-plugins' },
  { key: 'connectors', label: 'Connectors', icon: PlugZap, panelType: 'vault-connectors' },
];

const PANEL_TYPE_TO_NAV: Record<string, VaultNav> = Object.fromEntries(
  NAV_ITEMS.map((i) => [i.panelType, i.key]),
);

export const VaultSidebar: FC = () => {
  const vaultActiveNav = useUIStore((s) => s.vaultActiveNav);
  const setVaultNav = useUIStore((s) => s.setVaultNav);
  const openPanel = usePanelTabsStore((s) => s.openPanel);

  // Keep sidebar highlight in sync with whichever vault panel is currently
  // focused. If the user clicks a tab header in the center (instead of a
  // sidebar nav item), the sidebar still reflects the active section.
  useEffect(() => {
    const unsubscribe = usePanelTabsStore.subscribe((state) => {
      for (const tileState of state.tileTabs.values()) {
        const activeId = tileState.activeTabId;
        if (!activeId) continue;
        const inst = state.instances.get(activeId);
        if (!inst) continue;
        const navKey = PANEL_TYPE_TO_NAV[inst.panelType];
        if (navKey && navKey !== useUIStore.getState().vaultActiveNav) {
          useUIStore.getState().setVaultNav(navKey);
          return;
        }
      }
    });
    return unsubscribe;
  }, []);

  const handleClick = (item: NavItem): void => {
    setVaultNav(item.key);
    // Singleton panel (allowMultiple: false) — openPanel focuses the
    // existing tab if one is already open, otherwise creates it.
    openPanel(item.panelType);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 pb-2 pt-4 shrink-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">
          Vault
        </p>
        <p className="mt-1 text-sm font-medium text-foreground">
          Shared project context
        </p>
      </div>

      <div className="px-3 pb-2 space-y-1 shrink-0">
        {NAV_ITEMS.map(({ key, label, icon: Icon, panelType }) => {
          const isActive = vaultActiveNav === key;
          return (
            <button
              key={key}
              onClick={() => handleClick({ key, label, icon: Icon, panelType })}
              className={cn(
                'relative w-full h-10 px-3 flex items-center gap-2 rounded-[14px] text-xs transition-colors duration-150',
                isActive
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:bg-card hover:text-foreground',
              )}
            >
              {isActive && (
                <motion.div
                  layoutId="vault-nav-indicator"
                  className="absolute inset-0 rounded-[14px] border border-border/70 bg-card shadow-[0_12px_24px_-18px_rgba(0,0,0,0.35)]"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
              <Icon className="relative w-4 h-4 shrink-0" />
              <span className="relative flex-1 text-left font-medium">{label}</span>
            </button>
          );
        })}
      </div>

      <div className="mx-4 h-px shrink-0 bg-border/60" />

      <div className="flex-1 min-h-0 px-4 py-3">
        <p className="text-[10px] text-muted-foreground/50 leading-relaxed">
          Click any section to open it as a workspace tab.
          The vault is shared across all agent sessions in this project.
        </p>
      </div>
    </div>
  );
};
