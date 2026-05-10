/**
 * BranchDiffPanel — Codex-style unified diff view showing all branch changes
 */

import { useState, useEffect, useCallback } from 'react';
import { ExclamationTriangleIcon, ReloadIcon } from '@radix-ui/react-icons';
import { Loader2 } from 'lucide-react';
import { gitGetBranchDiff } from '@/lib/tauri/git';
import type { FileDiff } from '@/lib/tauri/git';
import type { PanelProps } from '@/lib/panels/types';
import { FileDiffSection } from './FileDiffSection';
import { VirtualList } from '@/components/ui/virtual-list';

interface BranchDiffData {
  branch?: string;
}

export const BranchDiffPanel = ({ data, onTitleChange }: PanelProps<BranchDiffData>) => {
  const [files, setFiles] = useState<FileDiff[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const branch = (data.branch as string | undefined) ?? undefined;

  useEffect(() => {
    onTitleChange(branch ? `Branch Changes: ${branch}` : 'All Branch Changes');
  }, [branch, onTitleChange]);

  const loadDiff = useCallback(() => {
    setIsLoading(true);
    setError(null);
    gitGetBranchDiff(branch)
      .then((result) => {
        setFiles(result);
        setIsLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setIsLoading(false);
      });
  }, [branch]);

  useEffect(() => {
    loadDiff();
  }, [loadDiff]);

  // Summary stats
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" size={16} />
        <span className="text-xs text-muted-foreground">Loading diff...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 px-6">
        <ExclamationTriangleIcon className="w-6 h-6 text-destructive" />
        <p className="text-xs text-muted-foreground text-center">{error}</p>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 px-6">
        <p className="text-xs text-muted-foreground">No changes on this branch</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Summary header */}
      <div className="flex items-center gap-3 px-4 h-9 shrink-0 border-b border-border/10 text-xs text-muted-foreground">
        <span>
          {files.length} file{files.length !== 1 ? 's' : ''} changed
        </span>
        <span className="flex items-center gap-1.5">
          {totalAdditions > 0 && (
            <span className="text-emerald-400">+{totalAdditions}</span>
          )}
          {totalDeletions > 0 && (
            <span className="text-red-400">-{totalDeletions}</span>
          )}
        </span>
        <button
          onClick={loadDiff}
          className="ml-auto p-1 rounded hover:bg-muted/50 transition-colors"
          title="Refresh diff"
        >
          <ReloadIcon className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Scrollable diff list */}
      <VirtualList
        items={files}
        estimateSize={() => 320}
        overscan={4}
        className="flex-1 px-3 py-2"
        itemClassName="pb-2"
        getItemKey={(file) => file.path}
        testId="branch-diff-files"
        renderItem={(file) => <FileDiffSection file={file} />}
      />
    </div>
  );
};
