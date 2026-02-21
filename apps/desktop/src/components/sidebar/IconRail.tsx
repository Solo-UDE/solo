/**
 * IconRail - 36px vertical icon strip with sliding accent indicator
 */

import type { FC } from 'react';
import { Files, ChatTeardrop, GitBranch, GithubLogo, SpinnerGap, SignOut } from '@phosphor-icons/react';
import { motion } from 'motion/react';
import { useUIStore } from '@/stores/uiStore';
import type { SidebarTab } from '@/stores/uiStore';
import { useGitHubAccountsStore } from '@/stores/githubAccountsStore';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const TABS: { key: SidebarTab; icon: typeof Files; label: string }[] = [
  { key: 'explorer', icon: Files, label: 'Explorer' },
  { key: 'sessions', icon: ChatTeardrop, label: 'Sessions' },
  { key: 'source-control', icon: GitBranch, label: 'Source Control' },
];

export const IconRail: FC = () => {
  const activeTab = useUIStore((s) => s.activeTab);
  const setActiveTab = useUIStore((s) => s.setActiveTab);

  const token = useGitHubAccountsStore((s) => s.token);
  const user = useGitHubAccountsStore((s) => s.user);
  const isConnecting = useGitHubAccountsStore((s) => s.isConnecting);
  const connectGitHub = useGitHubAccountsStore((s) => s.connectGitHub);
  const disconnectGitHub = useGitHubAccountsStore((s) => s.disconnectGitHub);

  const activeIndex = TABS.findIndex((t) => t.key === activeTab);

  return (
    <nav className="relative flex flex-col items-center w-9 shrink-0 py-3 gap-1 border-r border-white/[0.04]" role="tablist" aria-label="Sidebar navigation">
      {/* Sliding accent indicator */}
      <motion.div
        className="absolute left-0 w-[2px] h-5 rounded-r-full bg-primary"
        animate={{ top: 12 + activeIndex * 36 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      />

      {TABS.map(({ key, icon: Icon, label }) => (
        <button
          key={key}
          role="tab"
          aria-selected={activeTab === key}
          onClick={() => setActiveTab(key)}
          className={cn(
            'w-8 h-8 flex items-center justify-center rounded-lg',
            'transition-[transform,background-color,color] duration-200',
            'active:scale-95',
            activeTab === key
              ? 'text-foreground'
              : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/60 hover:scale-105',
          )}
          aria-label={label}
          aria-current={activeTab === key ? 'true' : undefined}
          title={label}
        >
          <Icon
            className="w-[18px] h-[18px]"
            weight={activeTab === key ? 'fill' : 'regular'}
            aria-hidden="true"
          />
        </button>
      ))}

      {/* GitHub status — pushed to bottom */}
      <div className="mt-auto">
        {isConnecting ? (
          <button
            className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground/60"
            title="Connecting to GitHub..."
            disabled
          >
            <SpinnerGap className="w-[18px] h-[18px] animate-spin" />
          </button>
        ) : token && user ? (
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="w-8 h-8 flex items-center justify-center rounded-lg transition-[transform,background-color] duration-200 hover:bg-muted/60 hover:scale-105 active:scale-95"
                title={user.login}
              >
                <img
                  src={user.avatar_url}
                  alt={user.login}
                  className="w-5 h-5 rounded-full"
                />
              </button>
            </PopoverTrigger>
            <PopoverContent side="right" align="end" className="w-52 p-3">
              <div className="flex items-center gap-2.5 mb-3">
                <img
                  src={user.avatar_url}
                  alt={user.login}
                  className="w-8 h-8 rounded-full"
                />
                <span className="text-sm font-medium truncate">{user.login}</span>
              </div>
              <button
                onClick={disconnectGitHub}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                <SignOut className="w-4 h-4" />
                Disconnect
              </button>
            </PopoverContent>
          </Popover>
        ) : (
          <button
            onClick={connectGitHub}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/60 hover:scale-105 active:scale-95 transition-[transform,background-color,color] duration-200"
            title="Sign in to GitHub"
          >
            <GithubLogo className="w-[18px] h-[18px]" />
          </button>
        )}
      </div>
    </nav>
  );
};
