/**
 * GitHubSetup — UI for connecting GitHub, creating repos, and initial setup.
 *
 * Uses GitHub Device Flow for authentication.
 */

import { useState, useCallback, useEffect } from 'react';
import type { FC } from 'react';
import { GithubLogo, Plus, Lock, Globe, CircleNotch, SignOut } from '@phosphor-icons/react';
import { Button, IconButton, Input } from '@solo/ui';
import { useGitStore } from '@/stores/gitStore';
import { useGitHubAccountsStore } from '@/stores/githubAccountsStore';
import { createRepo } from '@/lib/github-api';
import { gitSetup } from '@/lib/tauri/git';
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
  const ghToken = useGitHubAccountsStore((s) => s.token);
  const isConnecting = useGitHubAccountsStore((s) => s.isConnecting);
  const connectGitHub = useGitHubAccountsStore((s) => s.connectGitHub);
  const disconnectGitHub = useGitHubAccountsStore((s) => s.disconnectGitHub);
  const loadToken = useGitHubAccountsStore((s) => s.loadToken);
  const setGithubRepoUrl = useGitStore((s) => s.setGithubRepoUrl);

  // Load stored token on mount
  useEffect(() => {
    loadToken();
  }, [loadToken]);

  // Advance to create-repo step when connected
  useEffect(() => {
    if (ghUser && ghToken) {
      setStep('create-repo');
    }
  }, [ghUser, ghToken]);

  const handleConnect = useCallback(async () => {
    setError(null);
    try {
      await connectGitHub();
    } catch (err) {
      setError(String(err));
    }
  }, [connectGitHub]);

  const handleDisconnect = useCallback(async () => {
    await disconnectGitHub();
    setStep('connect');
  }, [disconnectGitHub]);

  const handleCreateRepo = useCallback(async () => {
    if (!ghUser || !ghToken || !repoName.trim()) return;
    setIsCreating(true);
    setError(null);

    try {
      const repo = await createRepo(ghToken, repoName.trim(), isPrivate);
      const cloneUrl = repo.clone_url;

      await gitSetup(cloneUrl, ghUser.login, `${ghUser.login}@users.noreply.github.com`);
      setGithubRepoUrl(cloneUrl);

      setIsCreating(false);
    } catch (err) {
      setError(String(err));
      setIsCreating(false);
    }
  }, [ghUser, ghToken, repoName, isPrivate, setGithubRepoUrl]);

  if (step === 'connect' || !ghUser || !ghToken) {
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

        <Button
          variant="primary"
          size="sm"
          onClick={handleConnect}
          disabled={isConnecting}
          className="h-[34px] px-4 text-xs bg-foreground text-background hover:bg-foreground/90 hover:brightness-100"
        >
          {isConnecting ? (
            <CircleNotch className="w-4 h-4 animate-spin" />
          ) : (
            <GithubLogo className="w-4 h-4" weight="bold" />
          )}
          {isConnecting ? 'Starting...' : 'Sign in with GitHub'}
        </Button>
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
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground">{ghUser.login}</p>
          <p className="text-2xs text-muted-foreground/60">Connected</p>
        </div>
        <IconButton
          variant="ghost"
          size="sm"
          onClick={handleDisconnect}
          title="Disconnect GitHub"
        >
          <SignOut className="w-3.5 h-3.5 text-muted-foreground" />
        </IconButton>
      </div>

      {/* Create repo form */}
      <div className="space-y-3">
        <div>
          <label className="text-2xs font-medium text-muted-foreground/60 uppercase tracking-wider mb-1 block">
            Repository Name
          </label>
          <Input
            value={repoName}
            onChange={(e) => setRepoName(e.target.value)}
            placeholder="my-project"
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

        <Button
          variant="primary"
          size="sm"
          onClick={handleCreateRepo}
          disabled={!repoName.trim() || isCreating}
          className="w-full h-[34px] text-xs"
        >
          {isCreating ? (
            <CircleNotch className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Plus className="w-3.5 h-3.5" weight="bold" />
          )}
          {isCreating ? 'Creating...' : 'Create Repository'}
        </Button>
      </div>
    </div>
  );
};
