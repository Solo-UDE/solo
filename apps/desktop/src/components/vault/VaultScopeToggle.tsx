/**
 * VaultScopeToggle — Global vs Project memory scope switch.
 */

import type { FC } from 'react';
import { Globe, FolderOpen } from '@phosphor-icons/react';
import { useVaultStore } from '@/stores/vaultStore';
import { useFileExplorerStore } from '@/stores/fileExplorerStore';
import { cn } from '@/lib/utils';

export const VaultScopeToggle: FC = () => {
  const activeScope = useVaultStore((s) => s.activeScope);
  const setScope = useVaultStore((s) => s.setScope);
  const rootPath = useFileExplorerStore((s) => s.rootPath);

  const isGlobal = activeScope.type === 'global';
  const hasProject = Boolean(rootPath);

  return (
    <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted/40">
      <button
        type="button"
        onClick={() => setScope({ type: 'global' })}
        className={cn(
          'flex-1 h-7 px-2 rounded-md flex items-center justify-center gap-1.5 text-[11px] font-medium transition-all duration-150',
          isGlobal
            ? 'bg-card text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.08)]'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <Globe className="w-3.5 h-3.5" weight={isGlobal ? 'fill' : 'regular'} />
        Global
      </button>
      <button
        type="button"
        disabled={!hasProject}
        onClick={() =>
          rootPath && setScope({ type: 'project', project_id: rootPath })
        }
        className={cn(
          'flex-1 h-7 px-2 rounded-md flex items-center justify-center gap-1.5 text-[11px] font-medium transition-all duration-150',
          !hasProject && 'opacity-40 cursor-not-allowed',
          !isGlobal
            ? 'bg-card text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.08)]'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <FolderOpen className="w-3.5 h-3.5" weight={!isGlobal ? 'fill' : 'regular'} />
        Project
      </button>
    </div>
  );
};
