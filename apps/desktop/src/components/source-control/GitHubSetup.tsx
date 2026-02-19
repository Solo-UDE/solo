/**
 * GitHubSetup — UI for connecting GitHub, creating repos, and initial setup
 */

import { useState, useCallback } from 'react';
import type { FC } from 'react';
import { GithubLogo, Plus, Lock, Globe, CircleNotch } from '@phosphor-icons/react';
import { useGitStore } from '@/stores/gitStore';
import { useGitHubAccountsStore } from '@/stores/githubAccountsStore';
import { createRepo } from '@/lib/github-api';
import { gitSetup } from '@/lib/tauri/git';
import { getAccessToken } from '@/lib/auth';
import { cn } from '@/lib/utils';

interface GitHubSetupProps {
  readonly className?: string;
}

type SetupStep = 'connect' | 'create-repo';

export const GitHubSetup: FC<GitHubSetupProps> = ({ className }) => {
  const [step, setStep] = useState<SetupStep>('connect');
  const [repoName, setRepoName] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ghUser = useGitHubAccountsStore((s) => s.user);
  const fetchUser = useGitHubAccountsStore((s) => s.fetchUser);
  const setGithubRepoUrl = useGitStore((s) => s.setGithubRepoUrl);

  // Handle connect (fetch user info)
  const handleConnect = useCallback(async () => {
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setError('No access token available. Please sign in first.');
        return;
      }
      await fetchUser(token);
      setStep('create-repo');
    } catch {
      setError('Failed to connect to GitHub. Please check your access token.');
    }
  }, [fetchUser]);

  // Handle repo creation
  const handleCreateRepo = useCallback(async () => {
    if (!ghUser || !repoName.trim()) return;
    setIsCreating(true);
    setError(null);

    try {
      const token = await getAccessToken();
      if (!token) {
        setError('No access token available.');
        setIsCreating(false);
        return;
      }

      const repo = await createRepo(token, repoName.trim(), isPrivate);
      const cloneUrl = repo.clone_url;

      // Setup git integration
      await gitSetup(cloneUrl, ghUser.login, `${ghUser.login}@users.noreply.github.com`);
      setGithubRepoUrl(cloneUrl);

      setIsCreating(false);
    } catch (err) {
      setError(String(err));
      setIsCreating(false);
    }
  }, [ghUser, repoName, isPrivate, setGithubRepoUrl]);

  if (step === 'connect' || !ghUser) {
    return (
      <div className={cn('flex flex-col items-center justify-center px-6 py-8', className)}>
        <div
          className={cn(
            'w-14 h-14 rounded-2xl flex items-center justify-center mb-4',
            'bg-muted/40',
          )}
        >
          <GithubLogo className="w-7 h-7 text-muted-foreground" weight="fill" />
        </div>
        <h3 className="text-sm font-semibold text-foreground mb-1">Connect to GitHub</h3>
        <p className="text-xs text-muted-foreground/60 text-center mb-5 leading-relaxed max-w-[200px]">
          Push and pull your code to a GitHub repository.
        </p>

        {error && (
          <p className="text-xs text-destructive mb-3 text-center">{error}</p>
        )}

        <button
          onClick={handleConnect}
          className={cn(
            'h-[34px] px-4 rounded-[10px] text-xs font-medium',
            'flex items-center gap-2',
            'bg-foreground text-background',
            'hover:brightness-110 active:scale-[0.97]',
            'disabled:opacity-40 disabled:pointer-events-none',
            'transition-[transform,background-color,color] duration-200',
          )}
        >
          <GithubLogo className="w-4 h-4" weight="bold" />
          Connect GitHub
        </button>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col px-4 py-4', className)}>
      {/* Connected account */}
      <div className="flex items-center gap-2.5 mb-4 px-1">
        <img
          src={ghUser.avatar_url}
          alt={ghUser.login}
          className="w-7 h-7 rounded-full"
        />
        <div>
          <p className="text-xs font-medium text-foreground">{ghUser.login}</p>
          <p className="text-[10px] text-muted-foreground/50">Connected</p>
        </div>
      </div>

      {/* Create repo form */}
      <div className="space-y-3">
        <div>
          <label className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-1 block">
            Repository Name
          </label>
          <input
            value={repoName}
            onChange={(e) => setRepoName(e.target.value)}
            placeholder="my-project"
            className={cn(
              'w-full h-9 px-3 rounded-lg text-xs',
              'bg-muted/40 border-none text-foreground placeholder:text-muted-foreground/50',
              'focus:bg-muted/60 focus:ring-1 focus:ring-ring/30 focus:outline-none',
              'transition-colors duration-150',
            )}
          />
        </div>

        {/* Visibility toggle */}
        <div className="flex gap-2">
          <button
            onClick={() => setIsPrivate(true)}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-xs',
              isPrivate
                ? 'bg-primary/10 text-primary border border-primary/20'
                : 'bg-muted/30 text-muted-foreground hover:bg-muted/50',
              'transition-[background-color,box-shadow] duration-150',
            )}
          >
            <Lock className="w-3 h-3" weight="bold" />
            Private
          </button>
          <button
            onClick={() => setIsPrivate(false)}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 h-8 rounded-lg text-xs',
              !isPrivate
                ? 'bg-primary/10 text-primary border border-primary/20'
                : 'bg-muted/30 text-muted-foreground hover:bg-muted/50',
              'transition-[background-color,box-shadow] duration-150',
            )}
          >
            <Globe className="w-3 h-3" weight="bold" />
            Public
          </button>
        </div>

        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}

        <button
          onClick={handleCreateRepo}
          disabled={!repoName.trim() || isCreating}
          className={cn(
            'w-full h-[34px] rounded-[10px] text-xs font-medium',
            'flex items-center justify-center gap-1.5',
            'bg-primary text-primary-foreground',
            'hover:brightness-110 active:scale-[0.97]',
            'disabled:opacity-40 disabled:pointer-events-none',
            'transition-[transform,background-color,color] duration-200',
          )}
        >
          {isCreating ? (
            <CircleNotch className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Plus className="w-3.5 h-3.5" weight="bold" />
          )}
          {isCreating ? 'Creating...' : 'Create Repository'}
        </button>
      </div>
    </div>
  );
};
