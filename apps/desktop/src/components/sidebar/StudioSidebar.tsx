/**
 * StudioSidebar - Business automation mode sidebar.
 * Vertical nav list with Sessions, Vault, Automations, Content Creation.
 */

import type { FC } from 'react';
import { motion } from 'motion/react';
import { ChatTeardrop, Vault, Lightning, PenNib } from '@phosphor-icons/react';
import { SessionList } from '@/components/agent';
import { VaultPanel } from '@/components/vault/VaultPanel';
import { AutomationsPlaceholder } from './studio/AutomationsPlaceholder';
import { ContentCreationPlaceholder } from './studio/ContentCreationPlaceholder';
import { useUIStore } from '@/stores/uiStore';
import type { StudioNav } from '@/stores/uiStore';
import { useSidebarActions } from '@/hooks/useSidebarActions';
import { cn } from '@/lib/utils';

interface NavItem {
  key: StudioNav;
  label: string;
  icon: FC<{ className?: string; weight?: 'regular' | 'fill' | 'bold' | 'duotone' }>;
  badge?: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'sessions', label: 'Sessions', icon: ChatTeardrop },
  { key: 'vault', label: 'Vault', icon: Vault },
  { key: 'automations', label: 'Automations', icon: Lightning },
  { key: 'content-creation', label: 'Content Creation', icon: PenNib },
];

const CONTENT_MAP: Record<StudioNav, FC<{ onSessionSelect: (id: string) => void; onNewSession: () => void }>> = {
  sessions: ({ onSessionSelect, onNewSession }) => (
    <SessionList
      onSessionSelect={onSessionSelect}
      onNewSession={onNewSession}
      className="h-full"
    />
  ),
  vault: () => <VaultPanel />,
  automations: () => <AutomationsPlaceholder />,
  'content-creation': () => <ContentCreationPlaceholder />,
};

export const StudioSidebar: FC = () => {
  const studioActiveNav = useUIStore((s) => s.studioActiveNav);
  const setStudioNav = useUIStore((s) => s.setStudioNav);
  const { handleSessionSelect, handleNewSession } = useSidebarActions();

  const ContentComponent = CONTENT_MAP[studioActiveNav];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Nav items */}
      <div className="px-2 py-1.5 space-y-0.5 shrink-0">
        {NAV_ITEMS.map(({ key, label, icon: Icon, badge }) => (
          <button
            key={key}
            onClick={() => setStudioNav(key)}
            className={cn(
              'relative w-full h-9 px-3 flex items-center gap-2 rounded-xl text-xs transition-colors duration-150',
              studioActiveNav === key
                ? 'text-primary'
                : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
            )}
          >
            {studioActiveNav === key && (
              <motion.div
                layoutId="studio-nav-indicator"
                className="absolute inset-0 rounded-xl bg-primary/10"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            <Icon className="relative w-4 h-4 shrink-0" weight={studioActiveNav === key ? 'fill' : 'regular'} />
            <span className="relative flex-1 text-left font-medium">{label}</span>
            {badge && (
              <span className="relative text-[9px] px-1.5 py-0.5 rounded-full bg-primary/8 text-primary/60 font-medium">
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Divider */}
      <div className="h-px mx-3 shrink-0" style={{ background: 'linear-gradient(to right, transparent, var(--border) 20%, var(--border) 80%, transparent)', opacity: 0.15 }} />

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ContentComponent
          onSessionSelect={handleSessionSelect}
          onNewSession={handleNewSession}
        />
      </div>
    </div>
  );
};
