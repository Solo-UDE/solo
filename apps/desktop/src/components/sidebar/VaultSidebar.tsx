/**
 * VaultSidebar — project-scoped, shared across all worktrees.
 *
 * Six sections: Skills, Memory, Tasks, Current Vault, Plugins, Connectors.
 * For now most are placeholder shells; Phase 3F wires up Memory against the
 * existing memory store. Sessions moved out of this tab — they're
 * worktree-bound and live under the Dev tab now.
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
import { VaultPlaceholder } from './vault/VaultPlaceholder';
import { VaultPanel } from '@/components/vault/VaultPanel';
import { useUIStore } from '@/stores/uiStore';
import type { VaultNav } from '@/stores/uiStore';
import { cn } from '@/lib/utils';

interface NavItem {
  key: VaultNav;
  label: string;
  icon: FC<{ className?: string }>;
  badge?: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'skills', label: 'Skills', icon: Sparkles, badge: 'Soon' },
  { key: 'memory', label: 'Memory', icon: Brain },
  { key: 'tasks', label: 'Tasks', icon: ListChecks, badge: 'Soon' },
  { key: 'current-vault', label: 'Current Vault', icon: VaultIcon },
  { key: 'plugins', label: 'Plugins', icon: Puzzle, badge: 'Soon' },
  { key: 'connectors', label: 'Connectors', icon: PlugZap, badge: 'Soon' },
];

// Placeholder shells until 3F lands per-section components. They all render
// the same stub copy keyed by section label so the UI reads coherently.
const PLACEHOLDER_BODY: Record<VaultNav, { title: string; description: string }> = {
  skills: {
    title: 'Skills',
    description: 'Curate the agent capabilities available to this project.',
  },
  memory: {
    title: 'Memory',
    description: 'Persistent context the agent references across sessions.',
  },
  tasks: {
    title: 'Tasks',
    description: 'Assignable work items, Linear-style, scoped to this project.',
  },
  'current-vault': {
    title: 'Current Vault',
    description: 'The active memory bundle the agent is drawing from right now.',
  },
  plugins: {
    title: 'Plugins',
    description: 'Install and toggle agent plugins for this project.',
  },
  connectors: {
    title: 'Connectors',
    description: 'External service integrations — Linear, Slack, and more.',
  },
};

export const VaultSidebar: FC = () => {
  const vaultActiveNav = useUIStore((s) => s.vaultActiveNav);
  const setVaultNav = useUIStore((s) => s.setVaultNav);

  const copy = PLACEHOLDER_BODY[vaultActiveNav];

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
        {NAV_ITEMS.map(({ key, label, icon: Icon, badge }) => (
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
            {badge && (
              <span className="relative rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary/70">
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mx-4 h-px shrink-0 bg-border/60" />

      <div className="flex-1 min-h-0 overflow-hidden">
        {vaultActiveNav === 'current-vault' ? (
          <VaultPanel />
        ) : (
          <VaultPlaceholder title={copy.title} description={copy.description} />
        )}
      </div>
    </div>
  );
};
