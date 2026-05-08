/**
 * SkillsSection — Vault surface for the skills marketplace.
 *
 * Three tabs:
 *  - Installed   — every skill on disk (Solo + adapter sources)
 *  - Marketplace — browse and install from `solo/skills-registry`
 *  - Forks       — installed skills the user has locally tweaked
 *
 * The heavy lifting lives in the three tab components — this file is the
 * navigation shell + layout.
 */

import type { FC } from 'react';
import { useState } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { InstalledSkillsTab } from './InstalledSkillsTab';
import { MarketplaceTab } from './MarketplaceTab';
import { ForksTab } from './ForksTab';

type Tab = 'installed' | 'marketplace' | 'forks';

const TABS: { readonly id: Tab; readonly label: string }[] = [
  { id: 'installed', label: 'Installed' },
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'forks', label: 'Forks' },
];

export const SkillsSection: FC = () => {
  const [active, setActive] = useState<Tab>('installed');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="tablist"
        aria-label="Skills"
        className="flex shrink-0 items-center gap-1 border-b border-border/50 px-4 py-2.5"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            onClick={() => setActive(tab.id)}
            className={cn(
              'relative min-h-9 flex-1 rounded-[10px] px-3 py-1.5 text-[12px] font-medium transition-[color,background-color] duration-150',
              active === tab.id
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {active === tab.id && (
              <motion.div
                layoutId="skills-tab-indicator"
                aria-hidden="true"
                className="absolute inset-0 rounded-[10px] border border-border/70 bg-card shadow-[0_8px_16px_-14px_rgba(0,0,0,0.35)]"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            <span className="relative">{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {active === 'installed' && <InstalledSkillsTab />}
        {active === 'marketplace' && <MarketplaceTab />}
        {active === 'forks' && <ForksTab />}
      </div>
    </div>
  );
};
