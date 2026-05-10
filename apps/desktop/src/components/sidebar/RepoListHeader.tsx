/**
 * RepoListHeader — "Repositories" title bar with Add Repository button and GitHub account
 */

import type { FC } from 'react';
import { GitHubLogoIcon, ExitIcon } from '@radix-ui/react-icons';
import { FolderPlus, Loader2 } from 'lucide-react';
import { useGitHubAccountsStore } from '@/stores/githubAccountsStore';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface RepoListHeaderProps {
  onAddRepo: () => void;
}

export const RepoListHeader: FC<RepoListHeaderProps> = ({ onAddRepo }) => {
  const token = useGitHubAccountsStore((s) => s.token);
  const user = useGitHubAccountsStore((s) => s.user);
  const isConnecting = useGitHubAccountsStore((s) => s.isConnecting);
  const connectGitHub = useGitHubAccountsStore((s) => s.connectGitHub);
  const disconnectGitHub = useGitHubAccountsStore((s) => s.disconnectGitHub);

  return (
    <div className="flex items-center justify-between h-9 px-3 shrink-0">
      <span className="text-xs font-medium text-muted-foreground/80 uppercase tracking-wider select-none">
        Repositories
      </span>

      <div className="flex items-center gap-0.5">
        {/* GitHub account */}
        {isConnecting ? (
          <button
            className="w-6 h-6 flex items-center justify-center rounded-lg text-muted-foreground/60"
            title="Connecting to GitHub..."
            disabled
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          </button>
        ) : token && user ? (
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="w-6 h-6 flex items-center justify-center rounded-lg transition-[transform,background-color] duration-200 hover:bg-muted/60 hover:scale-105 active:scale-95"
                title={user.login}
              >
                <img
                  src={user.avatar_url}
                  alt={user.login}
                  className="w-4 h-4 rounded-full"
                />
              </button>
            </PopoverTrigger>
            <PopoverContent side="right" align="start" className="w-52 p-3">
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
                <ExitIcon className="w-4 h-4" />
                Disconnect
              </button>
            </PopoverContent>
          </Popover>
        ) : (
          <button
            onClick={connectGitHub}
            className={cn(
              'w-6 h-6 flex items-center justify-center rounded-lg',
              'text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/60',
              'hover:scale-105 active:scale-95 transition-[transform,background-color,color] duration-200',
            )}
            title="Link GitHub to Solo"
          >
            <GitHubLogoIcon className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Add Repository */}
        <button
          onClick={onAddRepo}
          className={cn(
            'w-6 h-6 flex items-center justify-center rounded-lg',
            'text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/60',
            'hover:scale-105 active:scale-95 transition-[transform,background-color,color] duration-200',
          )}
          title="Add Repository"
        >
          <FolderPlus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
