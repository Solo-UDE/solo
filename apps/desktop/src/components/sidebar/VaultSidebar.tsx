/**
 * VaultSidebar — project-scoped, shared across all worktrees.
 *
 * Six sections: Skills, Memory, Tasks, Current Vault, Plugins, Connectors.
 * Each section has a dedicated component under `./vault/` that describes
 * what will live there. When a feature ships, its section component is
 * swapped for the real implementation without changing the nav shell.
 */

import type { FC } from 'react';
import { motion } from 'motion/react';
import {
  Sparkles,
  Brain,
  ListChecks,
  Vault as VaultIcon,
  Puzzle,
  PlugZap,
} from 'lucide-react';
import { SkillsSection } from './vault/SkillsSection';
import { MemorySection } from './vault/MemorySection';
import { TasksSection } from './vault/TasksSection';
import { CurrentVaultSection } from './vault/CurrentVaultSection';
import { PluginsSection } from './vault/PluginsSection';
import { ConnectorsSection } from './vault/ConnectorsSection';
import { useUIStore } from '@/stores/uiStore';
import type { VaultNav } from '@/stores/uiStore';
import { cn } from '@/lib/utils';

interface NavItem {
  key: VaultNav;
  label: string;
  icon: FC<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'skills', label: 'Skills', icon: Sparkles },
  { key: 'memory', label: 'Memory', icon: Brain },
  { key: 'tasks', label: 'Tasks', icon: ListChecks },
  { key: 'current-vault', label: 'Current Vault', icon: VaultIcon },
  { key: 'plugins', label: 'Plugins', icon: Puzzle },
  { key: 'connectors', label: 'Connectors', icon: PlugZap },
];

const SECTION_MAP: Record<VaultNav, FC> = {
  skills: SkillsSection,
  memory: MemorySection,
  tasks: TasksSection,
  'current-vault': CurrentVaultSection,
  plugins: PluginsSection,
  connectors: ConnectorsSection,
};

export const VaultSidebar: FC = () => {
  const vaultActiveNav = useUIStore((s) => s.vaultActiveNav);
  const setVaultNav = useUIStore((s) => s.setVaultNav);
  const Section = SECTION_MAP[vaultActiveNav];

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
        {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setVaultNav(key)}
            className={cn(
              'relative w-full h-10 px-3 flex items-center gap-2 rounded-[14px] text-xs transition-colors duration-150',
              vaultActiveNav === key
                ? 'text-foreground'
                : 'text-muted-foreground hover:bg-card hover:text-foreground',
            )}
          >
            {vaultActiveNav === key && (
              <motion.div
                layoutId="vault-nav-indicator"
                className="absolute inset-0 rounded-[14px] border border-border/70 bg-card shadow-[0_12px_24px_-18px_rgba(0,0,0,0.35)]"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            <Icon className="relative w-4 h-4 shrink-0" />
            <span className="relative flex-1 text-left font-medium">{label}</span>
          </button>
        ))}
      </div>

      <div className="mx-4 h-px shrink-0 bg-border/60" />

      <div className="flex-1 min-h-0 overflow-y-auto">
        <Section />
      </div>
    </div>
  );
};
