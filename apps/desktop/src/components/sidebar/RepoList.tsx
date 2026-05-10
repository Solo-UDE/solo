/**
 * RepoList — Scrollable list of repositories with empty state
 */

import type { FC } from 'react';
import { FolderPlus } from 'lucide-react';
import { useRepoList } from '@/stores/repoStore';
import { VirtualList } from '@/components/ui/virtual-list';
import { RepoItem } from './RepoItem';

interface RepoListProps {
  onAddRepo: () => void;
}

export const RepoList: FC<RepoListProps> = ({ onAddRepo }) => {
  const repos = useRepoList();

  if (repos.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 text-center">
        <div className="w-10 h-10 rounded-xl bg-muted/40 flex items-center justify-center">
          <FolderPlus className="w-5 h-5 text-muted-foreground/50" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground/70 mb-1">No repositories</p>
          <p className="text-xs text-muted-foreground/40">Add a repository to get started</p>
        </div>
        <button
          onClick={onAddRepo}
          className="h-8 px-3.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 active:scale-[0.97] transition-all duration-200"
        >
          Add Repository
        </button>
      </div>
    );
  }

  return (
    <VirtualList
      items={repos}
      estimateSize={() => 58}
      overscan={8}
      className="flex-1 py-1"
      getItemKey={(repo) => repo.path}
      testId="repo-list"
      renderItem={(repo) => <RepoItem repo={repo} />}
    />
  );
};
